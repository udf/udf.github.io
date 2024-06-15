---
author: "Sam"
title: "Automatically generating shareable secure links with nginx"
description: "Javascript saves lives."
date: 2024-06-13
tags: ["nginx", "devops"]
thumbnail: cover.jpg
---

## Introduction
I use nginx as a reverse proxy for several internal services, this simplifies setup because:
- The https certificates live in one place (in nginx)
- I can put every service behind a basic auth prompt
- Each service can be served from its own subdomain


## An example
It can be very annoying to have to restart nginx every time you want to test a nginx config change. The nginx docker container can be used to spin up a server with a specified config like so:


Create `nginx.conf` as:
```nginx
events {  }

http {
  server {
    listen 0.0.0.0:80;

    location / {
      proxy_pass http://example.com;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
      auth_basic "Authorization required";
      auth_basic_user_file /etc/nginx/.htpasswd;
    }
  }
}
```

Create a `.htpasswd` file with `htpasswd`:
```bash
% htpasswd -c .htpasswd <username>
New password: 
Re-type new password: 
Adding password for user <username>
```

Then run the server using docker (mounting the current directory as `/etc/nginx`):
```bash
% docker run --rm --name nginx_test -v .:/etc/nginx/:ro -p 80:80 nginx:latest
```


You can get the IP address of the container like so:
```bash
% docker inspect nginx_test | grep "IPAddress"
            "SecondaryIPAddresses": null,
            "IPAddress": "172.17.0.2",
```

Then your config can be tested by visiting that IP in a browser, or via curl:
```text
% curl 172.17.0.2
<html>
<head><title>401 Authorization Required</title></head>
<body>
<center><h1>401 Authorization Required</h1></center>
<hr><center>nginx/1.27.0</center>
</body>
</html>

% curl -u user:awoo 172.17.0.2
<!doctype html>
<html>
<head>
    <title>Example Domain</title>
...
```


## Sharing
Pretending that this is a real public facing server, let's say I want to share a link to a page with someone, and have it so they can only visit a single page.

The basic idea would be to generate an authentication token and place it in the URL, so that only one page can be visited - because if the token is invalid then the server will ask for authentication.

Luckily nginx has a builtin feature for this with [the secure links module](http://nginx.org/en/docs/http/ngx_http_secure_link_module.html).

The module works by validating that a hash of some value matches some other (usually user provided) value. For us we'll be validating that the hash of the URL (plus some secret) matches the value provided in some query parameter. Note that you can provide any value for the hash source and what to validate against, making the module incredibly flexible.

Specifically, the thing that we want to hash is provided using the `secure_link_md5` option, and the hash to validate against is provided using the `secure_link` option. You'd expect the hash to go in the option ending with `_md5`, but I guess the authors of the module had other ideas. We should also check that the request method is a GET because any other method (POST, PUT, etc) could modify the state of the upstream application.

Here's a solution I came up with:

```nginx
events {  }

http {
  server {
    listen 0.0.0.0:80;

    location / {
      secure_link $arg_sl_token;
      # MY_SECRET should be something only known by you so that no one else can
      # compute the correct token
      secure_link_md5 "$uri MY_SECRET";
      # note that $uri excludes any query parameters, so any parameters can be
      # passed if the token is known

      set $authentication "Authorization required";
      set $skip_auth $secure_link;
      # skip authentication check if token was correct and request method is GET
      set $skip_auth "$secure_link;$request_method";
      if ($skip_auth = "1;GET") {
        set $authentication "off";
      }

      auth_basic $authentication;
      auth_basic_user_file /etc/nginx/.htpasswd;

      proxy_pass http://example.com;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}
```

We can check its functionality by first trying to access it without the parameter and without authentication:
```text
% curl 'http://172.17.0.2'
<html>
<head><title>401 Authorization Required</title></head>
<body>
<center><h1>401 Authorization Required</h1></center>
<hr><center>nginx/1.27.0</center>
</body>
</html>
```

Then we can compute the hash and pass it as the `sl_token` parameter to bypass the authentication:
```bash
% echo -n '/ MY_SECRET' | openssl md5 -binary | openssl base64 | tr +/ -_ | tr -d =
m6hSIuxkCFHtysm3jbHRbA
% curl 'http://172.17.0.2?sl_token=m6hSIuxkCFHtysm3jbHRbA'
<!doctype html>
<html>
<head>
    <title>Example Domain</title>
...
```

This works, but has several issues:
1. Having to go to a terminal and compute the hash of the URI is a horrible user experience.
2. Ignoring the query parameters means anyone with the token can pass arbitrary parameters, which may pose a security risk depending on the upstream service.
3. The secret has to be baked into the nginx config, because it [isn\'t possible to use something like an environmental variable in the config file](https://serverfault.com/q/577370).


## Javascript to the rescue

The secure link module does not provide a way to read the expected hash. This makes it impossible to pass it to the authenticated user. However, nginx does have scripting capabilities that can be used to calculate the hash: [the njs module](https://nginx.org/en/docs/njs/), which lets you run Javascript code on each request. Using njs, we can solve all 3 of the problems of the previous solution:

1. If the user is authenticated, we can redirect to a URL containing the secret token (only if the token parameter was provided and incorrect, to prevent redirecting every single request). This way you can generate a shareable link on demand by appending `?sl_token=x` to the request.
2. The `sl_token` parameter can be stripped from the parameters before using the whole URL it to generate the token, preventing the parameters from being changed when accessing the service without being logged in.
3. The secret can be read from the environmental variables, allowing it to be kept out of the nginx config (and it can be provided to nginx by systemd's environment file feature, to prevent unauthorised users from reading the secret).

Building off of the njs example [secure_link_hash](https://github.com/nginx/njs-examples#secure-link-http-authorization-secure-link-hash), the implementation is actually pretty trivial:

`nginx.conf:`
```nginx
load_module modules/ngx_http_js_module.so;

events {  }

# preserve the SECRET_KEY environmental variable so it can be read from njs
env SECRET_KEY;

http {
  # only necessary for debugging (when using r.log in njs)
  # error_log /dev/stdout info;
  js_path "/etc/nginx/njs/";

  js_import sl_helper from secure_link_helper.js;

  js_set $sl_arg_token sl_helper.arg_token;
  js_set $sl_hashable_url sl_helper.hashable_url;
  js_set $sl_expected_hash sl_helper.expected_hash;
  js_set $sl_shareable_url sl_helper.shareable_url;

  server {
    listen 0.0.0.0:80;
    # the secure link token param name can be customised per server
    set $sl_param "sl_token";

    location / {
      # use a custom error page to bypass authentication by jumping to the @auth_success named location
      error_page 463 = @auth_success;
      secure_link $sl_arg_token;
      secure_link_md5 $sl_hashable_url;

      set $skip_auth "$secure_link;$request_method";
      if ($skip_auth = "1;GET") {
        return 463;
      }

      auth_basic "Authorization required";
      auth_basic_user_file /etc/nginx/.htpasswd;

      try_files /dev/null @auth_success;
    }

    location @auth_success {
      set $provided_token $sl_arg_token;
      # avoid redirecting if no token was provided
      if ($provided_token = "") {
        set $provided_token $sl_expected_hash;
      }
      # redirect on invalid token (will only happen if authentication succeeded)
      if ($provided_token != $sl_expected_hash) {
        rewrite ^ $sl_shareable_url? redirect;
      }

      proxy_pass http://example.com;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}
```

Note the use of a custom error page to do the authentication bypass, this is necessary because we want the redirect to only happen if authentication succeeded.

`njs/secure_link_helper.js`:
```js
import qs from "querystring";
import crypto from "crypto";

var DEFAULT_TOKEN_PARAM = 'sl_token';

// Gets the value of the token provided in the request
function arg_token(r) {
  var param_name = r.variables.sl_param || DEFAULT_TOKEN_PARAM;
  return r.args[param_name] || '';
}

// Returns the value that should be used to generate the token
function hashable_url(r) {
  var param_name = r.variables.sl_param || DEFAULT_TOKEN_PARAM;
  delete r.args[param_name];
  return `${r.uri}?${qs.stringify(r.args)} ${process.env.SECRET_KEY}`;
}

// Returns the expected hash for this request
function expected_hash(r) {
  return crypto.createHash('md5').update(hashable_url(r)).digest('base64url');
}

// Generates the shareable URL by setting the token parameter to the expected one
function shareable_url(r) {
  var param_name = r.variables.sl_param || DEFAULT_TOKEN_PARAM;
  r.args[param_name] = expected_hash(r);
  return `${r.uri}?${qs.stringify(r.args)}`;
}

export default {arg_token, hashable_url, expected_hash, shareable_url};
```

As a bonus, the name of the token parameter is now easily customisable by setting the `$sl_param` variable from nginx. This can be used to prevent conflicts with the existing parameters of the proxied service.


To run the above config, the docker command needs updating because we need the `/etc/nginx/modules` directory to be visible inside the container (previously we were shadowing the whole `/etc/nginx` directory), as well as passing the `SECRET_KEY` environmental variable:
```bash
% docker run --rm --name nginx_test -e SECRET_KEY="MY_SECRET" -v ./nginx.conf:/etc/nginx/nginx.conf:ro -v ./.htpasswd:/etc/nginx/.htpasswd:ro -v ./njs:/etc/nginx/njs:ro -p 80:80 nginx:latest
```

A secure link can be generated by passing an invalid value for the token, if you're authorised then nginx will respond with a redirect to the shareable URL:
```text
% curl -u user:awoo -D - 'http://172.17.0.2?sl_token=x'
HTTP/1.1 302 Moved Temporarily
Server: nginx/1.27.0
Date: Fri, 14 Jun 2024 14:30:39 GMT
Content-Type: text/html
Content-Length: 145
Location: http://172.17.0.2/?sl_token=9wKjSuzLdXxE-Evv9ASf5Q
Connection: keep-alive

<html>
<head><title>302 Found</title></head>
<body>
<center><h1>302 Found</h1></center>
<hr><center>nginx/1.27.0</center>
</body>
</html>
```


## Conclusion
This is of dubious usefulness because it only allows secure linking to single pages - any web app that makes more requests won't work because the authentication bypass is only for the top level link. A generic solution for generating a secure token for a family of pages is non-trivial, and probably also a fruitless endeavour.

Potentially, a set of regular expressions could be provided to transform the allowed URIs into a string containing some important data (like a resource ID), as well as a set of regular expressions for pages that are always allowed. Of course if the service uses anything other than a GET request then it becomes even harder to guarantee safe unauthenticated linking.

However, this project was good introduction to using njs, so maybe I'll develop something more useful with it later on.