---
author: "Sam"
title: "Brute forcing NixOS store paths for no particular reason"
description: "This is the second dumbest thing I've ever done."
date: 2022-02-07
tags: ["nixos", "memes"]
thumbnail: /taiga-this-is-dumb-thumb.jpg
---

## The Nix store

You might have noticed that when you build a package using Nix, it gets stored in `/nix/store` in a directory named something like `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-hello-2.10`.

While building a package I noticed that the hash started with "123", so that got me wondering, could I easily get it to say anything I wanted at the beginning?

The letters and numbers before the package name are a [SHA1 hash that's been base32 encoded](https://nixos.wiki/wiki/Nix_Hash). Note that since Nix uses [a custom base32 encoder](https://github.com/NixOS/nix/blob/7c64a9dfd4a8e9e171ea8b5c1806ca079b2f19ca/src/libutil/hash.cc#L83-L107) some words will be impossible to spell.


But where does the hash come from? There's an excellent pill about this: [Nix Store Paths](https://nixos.org/guides/nix-pills/nix-store-paths.html). We're interested in the [Output paths](https://nixos.org/guides/nix-pills/nix-store-paths.html#idm140737319577536) section, so since the output path only depends on inputs, we can manipulate some attribute of the derivation to affect the store hash.

## The idea
We can get the output path of a package using the `.outPath` attribute:

```bash
% nix-instantiate --eval -E '(import <nixpkgs> {}).hello.outPath'
"/nix/store/26x36dwihjw0d9kkzlk9qhl9ha2mx3jp-hello-2.10"
```

So let's use overrideAttrs to insert a dummy attribute and see if the hash changes:

```bash
nix-instantiate --eval -E '((import <nixpkgs> {}).hello.overrideAttrs (old: {test = 1;} )).outPath'
"/nix/store/syn0aajw44lzg7l6kwn58ksvhjv9ll81-hello-2.10"
```

Nice, so even attributes that don't actually affect the package at all will change the hash. That's sensible since at this stage Nix doesn't know what will affect the build in the first place.

So all we have to do is add a attribute with a different value each time and see if the resulting hash matches our criteria.

Another idea is to exploit a flaw in the now deprecated SHA1 to speed this up. However all I could find was how to do a [Length extension attack](https://en.wikipedia.org/wiki/Length_extension_attack) or a [Collision attack](https://en.wikipedia.org/wiki/Collision_attack) - which lets us find messages to get a certain hash - we want the other way around, a [Preimage attack](https://en.wikipedia.org/wiki/Preimage_attack). So we're stuck with brute-forcing.

## Probability
Assuming that SHA1 is evenly distributed, we can calculate how rare a hash with a certain number of fixed parts is. Since the paths are using base32, each character contains 5 bits of information (2<sup>5</sup> = 32). For example, let's say I want a hash that starts with "sam", that means there's a 1 in 2<sup>5 * 3</sup> = 32768 chance that our hash satisfies the condition. Of course more characters will exponentially increase the computation time.

## Putting it all together
That Nix expression we previously ran was pretty long, so let's start by working in a file:
```nix
with import <nixpkgs> {};
with lib;
with builtins;
let
  p = pkgs.hello;
in (
  (p.overrideAttrs (oldAttrs: rec { test = 1; })).outPath
)
```

We can run it like so:
```bash
% nix-instantiate --eval test.nix
"/nix/store/syn0aajw44lzg7l6kwn58ksvhjv9ll81-hello-2.10"
```

Alright, so we'll need to generate a list of values to change the hash, and then later parallelize it by evaluating our file multiple times.  
So how do we get a list of values to substitute into our test attribute? `builtins.genList` has it covered:
```bash
% nix-instantiate --eval -E 'builtins.genList (x: x) 10'
[ <CODE> <CODE> <CODE> <CODE> <CODE> <CODE> <CODE> <CODE> <CODE> <CODE> ]
```

Uhh... what? `<CODE>`? Those are supposed to be integers.

## Nix is well maintained
...and other jokes you can tell yourself. [Apparently nix-instantiate has had this issue for a while now\...](https://github.com/NixOS/nix/issues/3722)

Okay, so let's use `nix eval` instead:
```bash
% nix eval '(builtins.genList (x: x) 10)'
[ 0 1 2 3 4 5 6 7 8 9 ]
```

Great, now let's see how to pass arguments to the expression so we can later control where the generated list starts:
```bash
% nix eval '({x}: x)' --arg x 1
<LAMBDA>
```

So it's not calling the function? Oh wait, [this feature has been broken for longer than the issue we ran into with nix-instantiate](https://github.com/NixOS/nix/issues/2678).

Looks like the workaround is to either generate the whole expression with the value inserted, or to use environmental variables:
```
% a=hello nix eval '(builtins.getEnv "a")'
"hello"
```

## Putting it all together

```nix
with import <nixpkgs> { };
with lib;
with builtins;
let
  p = pkgs.hello;
  nIters = 10000;
  start = (fromJSON (getEnv "i")) * nIters;
in
toJSON (
  map
    (
      val: [
        val
        ((p.overrideAttrs (oldAttrs: rec { test = val; })).outPath)
      ]
    )
    (genList (x: x + start) nIters)
)
```
(Yes, I'm using `fromJSON` to convert from a string to an int, sue me)
Run the above with
```bash
i=0 nix eval -f test.nix ''
```

The output is (`nIters` set to 3 to keep it brief):
```
"[[0,\"/nix/store/l98gmxfxk0l6fp6qwysfdzzlhw7h820g-hello-2.10\"],[1,\"/nix/store/syn0aajw44lzg7l6kwn58ksvhjv9ll81-hello-2.10\"],[2,\"/nix/store/d36kg6qjgbrdc1c3m3gk0vzciqv5vis0-hello-2.10\"]]"
```

Now all we need is a quick python runner:
```python
import concurrent.futures
import time
import json
import logging
import os
import subprocess
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor


def check_block(i):
  env = os.environ.copy()
  env['i'] = f'{i}'
  try:
    p = subprocess.run(
        ['nix', 'eval', '--raw', '-f', 'test.nix', ''],
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        check=True,
        env=env
    )
  except subprocess.CalledProcessError:
    print(p.stderr)
    raise
  for v, path in json.loads(p.stdout.decode('utf-8')):
    if path.startswith('/nix/store/sams'):
      print(v, path)
      return True
  return False


workers = 24

block = 0
jobs = set()
running = True

with ThreadPoolExecutor(max_workers=workers) as executor:
  while running:
    if len(jobs) < workers:
      jobs.add(executor.submit(lambda i=block: check_block(i)))
      block += 1
      continue

    done, jobs = concurrent.futures.wait(jobs, timeout=1, return_when=FIRST_COMPLETED)
    for fut in done:
      try:
        if fut.result():
          running = False
      except:
        logging.exception('task exception')
```

And we're done... right?

## Not so fast
Upon running the above script, CPU usage shoots up to 100% but then drops back down to 10%  
After some investigation, the nix-daemon process (specifically the workers that it's spawned) are writing to disk a lot. Turns out that by evaluating a package to get the output path we're actually creating thousands of derivations in the Nix store. How many thousands?

```bash
% nix-collect-garbage -d
deleting '/nix/store/irw78bb6qddvclsgkirb87a3xcvfgfxg-hello-2.10.drv'
deleting '/nix/store/3jrvb4715lj7b0fqn1jdffvj3fnfq9x6-hello-2.10.drv'
deleting '/nix/store/76ps2ar5kp9k1rqnp2dbhsciylq1y37z-hello-2.10.drv'
... # (took about 20 minutes to complete)
718778 store paths deleted, 959.60 MiB freed
```

That many thousands.

## The only winning move is not to play
Derivations are essentially instructions on how to build a package, and creating thousands of them really isn't an issue (aside from eating away at finite SSD writes). Upon further investigation the slowdown seems to come from the Nix DB, which now has a very inflated size compared to another host:

```bash
[kurisu ~]% du -sh /nix/var/nix/db/db.sqlite
17M  /nix/var/nix/db/db.sqlite

[karen-chan ~]% du -sh /nix/var/nix/db/db.sqlite
495M  /nix/var/nix/db/db.sqlite
```

According to [Nix Pills](https://nixos.org/guides/nix-pills/install-on-your-running-system.html#idm140737320744880): "It is a sqlite database that keeps track of the dependencies between derivations.".

Looks like the "correct" way to this would be to look at the nix source code and create my own version of the hashing code, but that's way out of scope for a weekend project so I'm stopping here. Maybe I'll revisit this someday.

{{< figure src="/taiga-this-is-dumb.jpg" title="Goodbye." >}}