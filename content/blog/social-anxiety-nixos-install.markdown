---
author: "Sam"
title: "Setting up NixOS on a dedicated server"
description: "No human interaction needed."
date: 2021-02-09
tags: ["nixos", "devops"]
thumbnail: /feed-me-a-server.jpg
---

## Preamble

After about a year of paying 2 different providers for a seedbox (for linux ISOs)
and a VPS (for various selfhosted services). I decided it would make more sense if everything was on one larger server.

Side note: This whole idea came to mind because of my trouble running the Nix package manager on a shared (non-root) server for [SuperCrunchBot](https://github.com/udf/SuperCrunchBot).

I settled on a box from [Hetzner's server auction](https://www.hetzner.com/sb). It's has a 240 GB SSD, 2x 3TB HDDs, an i7 3770, and 16 GB of RAM. While the hardware is dated (that's a 9 year old CPU!), it is very cost effective coming in at €27/month - which is cheaper than I am paying for both of my current servers. Of course I'm not going to be running anything that relies on single-threaded performance like a game server on such an old CPU, but most workloads should be fine. Anyways, storage is the main thing I'm paying for here.

## Installing NixOS
This should be the standard Linux installation process, right? Mount ISO somehow then boot off of it and install things. Wait, how do you insert an ISO into a physical machine? You get someone to do it for you, more specifically, you request a technician to [roll over a KVM console](https://docs.hetzner.com/robot/dedicated-server/maintainance/kvm-console/) to your box (free for 3 hours, a bit pricey afterwards) and [plug in a USB drive](https://docs.hetzner.com/robot/dedicated-server/maintainance/kvm-console/#using-a-usb-stick).

## Social Anxiety
Well not really, but what if I don't feel like talking to someone and potentially having them watch the console while I struggle to figure out how I want to partition my drives?

### Your HDD is a USB drive
Instead of writing the ISO to a USB drive, it's possible to write the ISO to a local drive, upon reboot the BIOS *should* boot into the install medium.

Thankfully, these servers can boot into a rescue system which is essentially a stripped down version of Debian that it boots over the network.

So we can write the ISO to one of the HDDs with dd:

```bash
dd if=nixos.iso of=/dev/sda bs=4k status=progress
```

### If a system boots into a console without any input devices, did it really boot?
I can't control the system once it's booted, since that would require physical access (which is that the KVM console essentially gets you) - but we're not doing that here.

So what can we do? [Build our own ISO](https://nixos.wiki/wiki/Creating_a_NixOS_live_CD) with my ssh key included:

```nix
{config, pkgs, ...}:
{
  imports = [
    <nixpkgs/nixos/modules/installer/cd-dvd/installation-cd-minimal.nix>

    # Provide an initial copy of the NixOS channel so that the user
    # doesn't need to run "nix-channel --update" first.
    <nixpkgs/nixos/modules/installer/cd-dvd/channel.nix>
  ];

  systemd.services.sshd.wantedBy = pkgs.lib.mkForce [ "multi-user.target" ];
  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIzlWx6yy2nWV8fYcIm9Laap8/KxAlLJd943TIrcldSY sam@desktop"
  ];

  # Static IP since Hetzner doesn't have DHCP for these dedicated servers apparently
  # (I figured that out the hard way).
  networking = {
    usePredictableInterfaceNames = false;
    interfaces.eth0.ip4 = [{
      address = "5.9.43.<XX>";
      prefixLength = 27;
    }];
    defaultGateway = "5.9.43.65";
    nameservers = [ "213.133.98.98" "8.8.8.8" ];
  };
}
```

And that's about it, so I crossed my fingers and rebooted the system.

...and it worked!  
{{< figure src="/nixos-iso-hanzo-boot.jpg" title="You have no idea how happy I am" >}}

That's about the end of everything that [the excellent NixOS wiki](https://nixos.wiki/wiki/NixOS_Installation_Guide) can't explain.