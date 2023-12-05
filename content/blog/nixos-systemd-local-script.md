---
author: "Sam"
title: "How to run a local script as a systemd service on NixOS"
description: "No packaging necessary."
date: 2022-02-07
tags: ["nixos", "guide"]
thumbnail: /nixos-local-script-service.jpg
---

If your script is small and using shell, then your service definition could look like this:
```nix
systemd.services.something = {
  serviceConfig = {
    # ...
  };
  script = ''
    echo "hello world!"
  '';
};
```

However, if the script is longer and thus in a different file then you can use:
```nix
  script = "exec ${./scripts/hello.sh}";
```

Coercing a path object into a string like this automatically copies the file contents into the Nix store, so you get all the benefits of putting the text into your config (changing the file causes the unit to get rebuilt). Note that `builtins.toString` **does not** put the file into the store, it simply converts the path into a string.

Other languages are easy too! For a Python script you can use
{{< highlight nix "hl_inline=true" >}}script = "python ${./scripts/hello.py}";{{< /highlight >}}
(assuming you put
{{< highlight nix "hl_inline=true" >}}${pkgs.python3}{{< /highlight >}}
into the unit's path.)

-----

Why do we need to specify the program to use to run the script?  
Can we use a hashbang in our script and simply do
{{< highlight nix "hl_inline=true" >}}script = "${./scripts/hello.py};{{< /highlight >}}
?

Yes, but not like that. **Our script does not end up executable** and the functionality to place a file into the Nix store when converting a path to a string doesn't take any options. See [stackoverflow: When does a nix path type make it into the nix store and when not?](https://stackoverflow.com/a/43850372) for details.

So how does the systemd module turn our first script into a executable file? [With `pkgs.writeTextFile`](https://github.com/NixOS/nixpkgs/blob/c28fb0a4671ff2715c1922719797615945e5b6a0/nixos/modules/system/boot/systemd.nix#L210):
```nix
  makeJobScript = name: text:
    let
      scriptName = replaceChars [ "\\" "@" ] [ "-" "_" ] (shellEscape name);
      out = pkgs.writeTextFile {
        # The derivation name is different from the script file name
        # to keep the script file name short to avoid cluttering logs.
        name = "unit-script-${scriptName}";
        executable = true;
        destination = "/bin/${scriptName}";
        text = ''
          #!${pkgs.runtimeShell} -e
          ${text}
        '';
        checkPhase = ''
          ${pkgs.stdenv.shell} -n "$out/bin/${scriptName}"
        '';
      };
    in "${out}/bin/${scriptName}";
```

Unfortunately for us, this function is in a `let...in` statement and isn't copied anywhere where we can access it. So we have to copy it to our file to reuse it. After some edits, it looks like this:

```nix
# make-script.nix
{ lib, pkgs }:
with lib;
with builtins;
(path:
  let
    shellEscape = s: (replaceChars [ "\\" ] [ "\\\\" ] s);
    scriptName = replaceChars [ "\\" "@" ] [ "-" "_" ] (shellEscape (baseNameOf path));
    out = pkgs.writeTextFile {
      name = "script-${scriptName}";
      executable = true;
      destination = "/bin/${scriptName}";
      text = readFile path;
    };
  in
  "${out}/bin/${scriptName}"
)
```

Usage is pretty simple:
```nix
let
  makeScript = import ../helpers/make-script.nix { inherit lib pkgs; };
in
{
  systemd.services.something = {
    serviceConfig = {
      ExecStart = makeScript ./scripts/hello.py;
    };
  };
}
```

However that means we need to import our helper function every time we want to use it,
which is arguably not as clean as what we had in the beginning.