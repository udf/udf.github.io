---
author: "Sam"
title: "NixOS - Automatically restarting a systemd unit when a local config file changes"
description: "A simple fix for a simple problem."
date: 2022-03-15
tags: ["nixos", "guide"]
thumbnail: /nixos-auto-restart-service.jpg
---

## The Setup
I have a service that gets its config file from my NixOS config directory, more specifically:

```nix
{ config, lib, pkgs, ... }:
with lib;
{
  environment.etc."watcher-bot/config.py".source = ../constants/watcher-config.py;

  systemd.services.watcher-bot = {
    # ... other options here
    environment = {
      PYTHONPATH = "/etc/watcher-bot";
    };
  };
}
```

This makes the contents of `../constants/watcher-config.py` (relative to the current `.nix` file) available at `/etc/watcher-bot/config.py`.  
The `PYTHONPATH` environment variable makes it possible to do `import config` from Python.

## Problems
This works great, but there's an issue: how do I automatically restart the service when the file changes?
Using [systemd.services.\<name\>.restartTriggers](https://search.nixos.org/options?channel=21.11&show=systemd.services.%3Cname%3E.restartTriggers&from=0&size=50&sort=relevance&type=packages&query=systemd.services.%3Cname%3E.restartTriggers):


```nix
  systemd.services.watcher-bot = {
    # ... other options here
    environment = {
      PYTHONPATH = "/etc/watcher-bot";
    };
    restartTriggers = [
      config.environment.etc."watcher-bot/config.py".source
    ];
  };
```

But this doesn't cause changes of the file to restart the unit! What's going on here?

The documentation for `restartTriggers` says:
> An arbitrary list of items such as derivations. If any item in the list changes between reconfigurations, the service will be restarted. 

The way this works is by writing the contents of the list to the `X-Restart-Triggers` option in the unit,
which changes the unit file if the list contents do (systemd does not do anything with this option).

The important part is "If any **item in the list** changes" -
I'm just pointing it to the path of the config in the Nix config directory, and editing the file doesn't change the path.

If you're using `pkgs.writeText` or similar to write a string to the Nix store,
then the path **does** change when the file does as it's written to a path like
`/nix/store/<hash>-my-config` as changing the contents changes the hash,
which changes the path, which causes the unit to change, which causes Nix to restart the service.

## Solution
Well, is there a way to get a file into the store without having to provide its contents as a string?  
Yes, `pkgs.copyPathToStore` does exactly this:

```nix
{
  environment.etc."watcher-bot/config.py".source = (pkgs.copyPathToStore ../constants/watcher-config.py);
}
```

But we can shorten it to:

```nix
{
  environment.etc."watcher-bot/config.py".source = "${../constants/watcher-config.py}";
}
```
...since Nix copies paths to the store when turning paths into strings.

Now the path evaluates to something like `/nix/store/<hash>-watcher-config.py`, so changes to the file will cause the service to be restarted.

The usage of `/etc` for this is unnecessary at this point, with some restructuring I can add a
directory containing the `config.py` to the store, and give that path in `PYTHONPATH` to the unit:

```nix
  systemd.services.watcher-bot = {
    # ... other options here
    environment = {
      PYTHONPATH = "${../constants/watcher}";
    };
  };
```

## Alternate solution
You could also have Nix put the hash of the file in the `restartTriggers`, this is useful if:
- You want to keep the file out of the Nix store
- The file is available to Nix at build time (system config generation runs as root)

For example, putting the config in the service's home directory:
```nix
  systemd.services.watcher-bot = {
    # ... other options here
    environment = {
      PYTHONPATH = "/home/watcher/config/";
    };
    restartTriggers = [
      (builtins.hashFile "sha256" /home/watcher/config/config.py)
    ];
  };
```