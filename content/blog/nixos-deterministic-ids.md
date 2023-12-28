---
author: "Sam"
title: "Making user IDs deterministic on NixOS"
description: "Now with $100% more containers!"
date: 2021-07-18
tags: ["nixos", "containerisation"]
thumbnail: /kuroneko-deterministic.png
---

## Why?
Users/groups specified from the NixOS config have their IDs automatically picked based on what's free at the time of being added.
This means the IDs vary from system to system, as they depends on what order you add things to the config.
Typically this doesn't matter unless you're sharing a filesystem with another system, which would result in having files owned by non-existent/incorrect users.
This can happen when running NixOS containers, and needing to access the files on the host system (or from another container).
While you could manually map all the IDs that will be writing to the shared filesystem, it would be better to automate it.

## An idea
A solution to this would be to change the way IDs are picked so that they are deterministic.
This can be done by hashing the name of the user/group and using it to generate the ID.
We would want to reserve some IDs at the beginning to not break existing IDs and leave room to manually assign things, if needed.
There is the possibility of hash collisions, but the config should fail to build if that's the case - this would need to be manually resolved by assigning IDs to the colliding entries.
Of course this makes the auto-generated IDs very large and hard to memorise, but that's a trade-off I'm willing to make for having permissions function as expected.

## Honey, where are my primitives?
Luckily Nix has a builtin function to hash strings:
```nix
nix-repl> builtins.hashString "sha1" "hello"
"aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
```

So all we need to do is take the first 8 characters and convert them to an integer to get our ID.
Unfortunately, there's no builtin for converting a hex string to an integer!

Though, it's pretty trivial to build our own functions for that.
All we need to do is convert each hex character into a number and add them together using the fold function:

```nix
{
  # set that maps hex characters to their value {"0" = 0; ... "a" = 10; ...}
  hexChars = listToAttrs (imap0 (i: v: {name = v; value = i;}) (stringToCharacters "0123456789abcdef"));
  # Converts a (lowercase) hex string to an integer by successively adding the values of each character
  hexToInt = s: foldl (a: b: a * 16 + hexChars."${b}") 0 (stringToCharacters s);
}
```

I'm not sure what the acceptable range of IDs are so I went with an unsigned 32-bit integer as the maximum.
There is a possibility that 64-bit IDs are fine, but I did not test them.
Also sha1 is deprecated, but I don't see any advantage to using something else as we only care about the determinism for this use case.

## Putting it all together
Options declared across modules are merged into one set.

For example, if one module declares:
```nix
{
  users.users.alice = {...};
}
```
And another declares:
```nix
{
  users.users.bob = {...};
}
```
Then both of those get merged into the final config set as:
```nix
{
  users.users = {
    alice = {...};
    bob = {...};
  };
}
```

The key to this while thing working is that after the config is merged, the `apply` function is run.
This is where we would want to add IDs to all the entries that don't have one.
But how can we get our setting into the option declared by nixpkgs?
```nix
# somewhere inside nixpkgs/nixos/modules/config/users-groups.nix
  options = {
    users.users = mkOption {
      default = ...;
      type = ...;
      # default settings...
      apply = # our code here?
    };
  };
```

You might have not realised it, but option *declarations* are also merged just like values are!
This means we can simply re-declare `options.users.users` to set the `apply` attribute just like as if it was included in nixpkgs from the start.

```nix
{
  options.users.users = mkOption {
    apply = v: v // (myFunction v);
  };
  options.users.groups = mkOption {
    apply = v: v // (myFunction v);
  };
}
```

This will cause `myFunction` to be called with the whole set of users/groups.
Our code would then need to filter out all the users/groups without IDs and insert the generated ID.
This is just boring shuffling around data stuff so I'm not going to describe it.

Here's the final code:
```nix
{ lib, ... }:
with lib;
with builtins;
let
  userFilter = v: filterAttrs (user: opts: (opts.uid == null)) v;
  groupFilter = v: filterAttrs (group: opts: (opts.gid == null)) v;

  hexChars = listToAttrs (imap0 (i: v: {name = v; value = i;}) (stringToCharacters "0123456789abcdef"));
  hexToInt = s: foldl (a: b: a * 16 + hexChars."${b}") 0 (stringToCharacters s);

  genHash = s: (hexToInt (substring 0 8 (hashString "sha1" s))) * 65535 / 65536 + 65536;
  genId = outAttr: name: opts: opts // {"${outAttr}" = genHash name;};
  genIds = outAttr: sets: mapAttrs (genId outAttr) sets; 
in
{
  options.users.users = mkOption {
    apply = v: v // (genIds "uid" (userFilter v));
  };
  options.users.groups = mkOption {
    apply = v: v // (genIds "gid" (groupFilter v));
  };
}
```

The funny looking math in `genHash` is simply mapping the range [0, 0xFFFFFFFF] to [0x10000, 0xFFFFFFFF].
Which reserves 0-65536 for manual use and prevents conflicts with existing users.