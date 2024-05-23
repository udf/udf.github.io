---
author: "Sam"
title: "Generating a custom Syncthing device ID"
description: "Et tu, Brute-force?"
date: 2024-05-22
tags: ["syncthing", "openssl"]
thumbnail: /syncthing-device-id.jpg
---

## What's a Syncthing?
From [syncthing.net](https://syncthing.net/):
> Syncthing is a continuous file synchronization program.
It synchronizes files between two or more computers in real time, safely protected from prying eyes.

The "safely protected from prying eyes" part refers to the encryption that Syncthing employs,
which is based on TLS - the very same encryption scheme that you're using to read this blog post.

TLS relies on asymmetric encryption for the key exchange,
which you can read more about in [this Cloudflare article](https://www.cloudflare.com/en-gb/learning/ssl/what-is-asymmetric-encryption/).

A rough overview of asymmetric encryption is that it has two keys,
one for encryption (the public key) and another for decryption (the private key).  
This means anyone who has your public key can send you messages that only you can decrypt,
which makes it very useful for verifying identities.


## Device IDs
Syncthing has a really good article about how the Device IDs are generated: https://docs.syncthing.net/dev/device-ids.html

Essentially, the device ID is a fingerprint of the public key,
specifically it is part of the SHA-256 hash of the certificate data (public key) converted to Base32.  
Base32 is like the decimal system that you're used to, but instead of using `0123456789` it uses `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`.

In the article linked above, we can see that a device ID looks something like:  
`O5EPCGF-33IITRA-YTIWULB-XFZSU6B-LE34FCE-KVIJDNX-KVLVFZ5-E4SRXQH`

It is in the format `xxxxxxx-xxxxxxA-xxxxxxx-xxxxxxB-xxxxxxx-xxxxxxC-xxxxxxx-xxxxxxD`,
where `A`, `B`, `C`, and `D` are check digits using [a slightly altered version of the Luhn mod N algorithm](https://forum.syncthing.net/t/v0-9-0-new-node-id-format/478/5), and the `x`s are characters from the hash represented in base32.

Each group of the ID is 7 characters long, and the first group is displayed in the GUI in the identification section:
{{< figure src="/syncthing-device-gui.png" title="A device in Syncthing's GUI" >}}


## A dumb idea
Similarly to how I previously [attempted to generate NixOS store paths with a particular prefix](/blog/custom-partial-nix-store-path),
keys could be repeatedly generated until a given prefix shows up at the beginning of the resulting device ID.

This would allow you to spell the name of the device out in the UI shown above (or anything that you want). It is also similarly pointless, but at least this time
the results would be displayed relatively prominently in the Syncthing GUI.


## Probability and brute force
This time, instead of the 1 in 2<sup>5 * 3</sup> = 32768 chance for matching the first 3 characters from a base32 version of a hash,
we want to generate one with the 7 matching characters, which is a 1 in 2<sup>5 * 7</sup> = 34359738368 chance.  
That's 34 billion, which seems infeasible depending on how fast we can generate new device IDs.

The important thing to note is that we do not need to find a match for all 7 characters, 3 or 4 are good enough
for a personalised ID.


## Calculating the device ID
The article about device IDs [linked above](#device-ids),
mentions that the hash includes the whole certificate data rather than just the public key,
specifically that it is the "SHA-256 hash of the certificate data in DER form".  
The certificates for a user are stored in ~/.config/syncthing on Linux.

We can convert a certificate in PEM format to DER using `openssl`:
```bash
% openssl x509 -in cert.pem -out cert.der -outform DER
```

But there is no need to store it into a separate file, the whole hashing operation can be done at once using pipes:
```bash
% openssl x509 -in cert.pem -outform DER | openssl dgst -binary -sha256 | base32
O5EPCGF33IITRYTIWULBXFZSU6LE34FCEKVIJDNKVLVFZ5E4SRXQ====
```

This matches the device ID exactly (barring the check digits, which we can ignore because they do not appear until the 14th character).


## More data?
Certificates include more than just the private key:
```bash
% openssl x509 -noout -text -in cert.pem
Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number:
            6b:3b:55:51:9c:e4:47:c3:1f:e4:1c:f9:81:18:5d:18:66:c3:50:70
        Signature Algorithm: ecdsa-with-SHA256
        Issuer: CN=syncthing
        Validity
            Not Before: Jan  5 15:19:41 2019 GMT
            Not After : Dec 31 23:59:59 2049 GMT
        Subject: CN=syncthing
        Subject Public Key Info:
            Public Key Algorithm: id-ecPublicKey
                Public-Key: (384 bit)
                pub:
                    04:15:2c:61:4f:1a:fd:ab:e1:8f:37:97:42:74:7f:
                    1e:af:45:a3:94:2b:c0:ba:66:65:26:d8:a3:91:d1:
                    3a:e0:05:f6:43:7d:c0:73:8a:f6:4d:79:91:bb:70:
                    28:15:9c:36:97:09:8d:88:8d:9a:a0:00:3e:e3:56:
                    af:4f:7e:24:86:f8:0c:e8:ce:1c:a0:fe:ac:f4:5f:
                    94:1f:89:ac:35:ec:44:6d:2b:0c:19:59:59:6f:a1:
                    7e:f9:a2:00:58:c5:b9
                ASN1 OID: secp384r1
                NIST CURVE: P-384
        X509v3 extensions:
            X509v3 Subject Key Identifier: 
                99:4F:79:F9:91:A9:4A:AB:69:E3:08:D0:06:8C:F5:83:EE:11:51:03
    Signature Algorithm: ecdsa-with-SHA256
    Signature Value:
        30:65:02:30:5e:03:3d:40:95:6e:16:82:65:47:c6:8b:fd:b2:
        b1:16:71:e8:74:b1:c3:9b:b9:07:f4:f1:f4:e9:91:44:09:31:
        1b:09:2c:70:04:91:e9:9a:79:ce:55:ac:82:4d:ad:7f:02:31:
        00:cf:4f:de:09:d0:ef:96:91:a3:4b:95:e3:01:3e:cf:72:92:
        78:33:e3:30:cc:d9:08:78:54:d9:d1:11:c7:7d:e3:9e:16:cf:
        df:b3:08:62:b4:aa:af:18:78:f6:45:63:27
```

Changing anything here will alter the resulting hash, and thus the device ID.  
The serial number looks like a good candidate for a value that can be changed without issue.

So we can repeatedly generate new certificates with different serial numbers and check their hashes until the beginning matches a value that we want.


## Signing certificates
The process of generating a self-signed certificate is actually quite simple.

The existing private key can be used, or a new one can be generated with:
```bash
% openssl ecparam -genkey -name secp384r1 -out key.pem
```

To create a new self signed certificate from the given private key `key.pem`:
1. Create a certificate signing request (CSR):
```bash
% openssl req -new -key key.pem -out cert.csr -nodes -subj "/C=/ST=/L=/O=/OU=/CN=syncthing"
```
(I've set all the fields other than the Common Name to blank,
as well as disabled encryption with `-nodes`,
so that `openssl` does not prompt for any information)

2. Create the certificate by signing the CSR with the private key:
```bash
% openssl x509 -req -days 10950 -in cert.csr -signkey key.pem -out cert_new.pem
Certificate request self-signature ok
subject=CN=syncthing
```

We can check the hash of the resulting certificate to see that the device ID has indeed changed:
```bash
% openssl x509 -in cert_new.pem -outform DER | openssl dgst -binary -sha256 | base32
BC24A23ATYFQGOCBNNHIQPKBBYLW3GZDTBQ3CLQVRHZMOI6VNLHA====
```

The same CSR can be signed multiple times, and of course we can omit writing to a file and have `openssl` output the key in DER form directly:
```bash
% openssl x509 -req -days 10950 -in cert.csr -signkey key.pem -outform DER 2>/dev/null | openssl dgst -binary -sha256 | base32
M3P6YDXOGBDFM722ZOKSSSDBUPCRKW5OEK7XO5QGVPSL3PI3HFNA====
% openssl x509 -req -days 10950 -in cert.csr -signkey key.pem -outform DER 2>/dev/null | openssl dgst -binary -sha256 | base32
LNQAT47FG6LESHN3LBCJEASR56LGHEFNAN4OHTDUCTS5ZGI3BFLA====
% openssl x509 -req -days 10950 -in cert.csr -signkey key.pem -outform DER 2>/dev/null | openssl dgst -binary -sha256 | base32
MTKLDLSKJSXEFNJDHBLBYFGIN5QBLQTOGEXLUYMW3UFWADMVONWQ====
```

The output is different each time because a new serial number is created for each certificate, thus changing the hash of the certificate.


## Probability 2: Electric Boogaloo
The probability of finding a match can be increased by allowing numbers to substitute for letters.

For example if we're looking for a device ID that starts with `SAM`,
the chance of finding it is 1 in 32<sup>3</sup> = 1 in 32768,
but if we allow a 4 to substitute for the A, then it becomes 2 in 32768, which is 1 in 16384,
and if we allow a 5 to substitute for the S, then it becomes 4 in 32768, which is 1 in 8192.  
A regular expression to check for this would be `/[S5][A4]M/`

This doesn't make a big difference to run times for such a short string, but something long like trying to find
a device ID starting with SAMARA, we can drastically increase the odds by 16x by checking for `/[S5][A4]M[A4]R[A4]/`.


## Et tu, Brute-force?
I've adapted my Python script from [the previous time I tried brute-forcing hashes](/blog/custom-partial-nix-store-path/#putting-it-all-together-1):
```python
import base64
import concurrent.futures
import logging
import re
import subprocess
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor
from hashlib import sha256

from tqdm import tqdm


target_re = re.compile(b'[S5][A4]M')


def check_cert(i):
  try:
    p = subprocess.run(
      ['openssl', 'x509', '-req', '-days', '10950', '-in', 'cert.csr', '-signkey', 'key.pem', '-outform', 'DER', '-set_serial', str(i)],
      stderr=subprocess.PIPE,
      stdin=subprocess.DEVNULL,
      stdout=subprocess.PIPE,
      check=True
    )
  except subprocess.CalledProcessError as e:
    progress.write(e.stderr)
    raise

  h = base64.b32encode(sha256(p.stdout).digest())
  if target_re.match(h):
    progress.write(f'Writing {i}.der')
    with open(f'{i}.der', 'wb') as f:
      f.write(p.stdout)
    return True

  return False


workers = 24

block = 0
jobs = set()
running = True
progress = tqdm()

with ThreadPoolExecutor(max_workers=workers) as executor:
  while running:
    if len(jobs) < workers:
      jobs.add(executor.submit(lambda i=block: check_cert(i)))
      block += 1
      progress.update(1)
      continue

    done, jobs = concurrent.futures.wait(jobs, timeout=1, return_when=FIRST_COMPLETED)
    for fut in done:
      try:
        if fut.result():
          running = False
      except:
        logging.exception('task exception')
```

It expects a certificate signing request (`cert.csr`) and the private key (`key.pem`) to be in the working directory. Also I'm using [tqdm](https://github.com/tqdm/tqdm) to print the current processing speed.

Now all that's left is to run it:

```bash
% python cert_bruteforce.py
Writing 14399.der
14423it [00:11, 1231.70it/s]

$ <14399.der openssl dgst -binary -sha256 | base32
5AMN7XGZPXFLSUHKIPZBHLUQBXHFVIDP3FGLRRIIXDD6H3CRWO5Q====
```

It took 11 seconds at a rate of ~1200 certificates/s to find a matching candidate.  
That's faster than I expected. Do note that each extra character lowers the odds of finding a match by 32x.

For example, it took quite some time to find a match for `/[A4][L7]IC[E3]/`:
```bash
% python cert_bruteforce.py
Writing 2327237.der
2327267it [31:10, 1244.22it/s]
```

This is not unexpected, as we can estimate the amount of time it will take (on average) as follows:
- 32<sup>5</sup> = 1 in 33554432 chance
- 3 possible substitutions of 2 options each, 33554432 / 2<sup>3</sup> = 1 in 4194304 chance
- 4194304 at 1200 tries/s = 3495 / 2 seconds, or ~29 minutes on average (it'll take you half of the total number of combinations to find a match, on average).

The DER cert can then be converted to PEM format for use with Syncthing like this:
```bash
$ openssl x509 -inform DER -in 2327237.der -out cert.pem
```

And after replacing the `cert.pem` and `key.pem` files and restarting Syncthing (as well as re-accepting every share on every device):
{{< figure src="/syncthing-device-alice.jpg" title="The custom device ID now matches the device name, how chic!" >}}
