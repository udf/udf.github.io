---
author: "Sam"
title: "In-place rebuilding of a docker compose project with systemd"
description: "Did you just restart prod again?"
date: 2024-05-15
tags: ["containerisation", "docker", "systemd"]
thumbnail: cover.jpg
---

## The usual approach
If you do a search about how to run docker compose with systemd, you get something similar to this:

```systemd
[Unit]
Description=Some docker compose service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=true
WorkingDirectory=/path/to/project
ExecStart=/usr/bin/docker-compose up --build -d
ExecStop=/usr/bin/docker-compose down

[Install]
WantedBy=multi-user.target
```

While this works, it has some issues:
- No logs are output to the journal (all the logs for every container are on the docker daemon's service, however)
- Restarting the service will take all the containers down before bringing them up again

There's also no automated restarts if a container fails, but you should manage that with a [restart policy on each service in the compose file](https://docs.docker.com/compose/compose-file/05-services/#restart).

## A (slightly) better approach
One solution is to turn it into a regular unit so that we can use `docker-compose up` to attach to the confiners and print the logs:

```systemd
[Unit]
Description=Some docker compose service
Requires=docker.service
After=docker.service

[Service]
WorkingDirectory=/path/to/project
# wait for the containers to come up before the service is considered "started"
ExecStartPre=/usr/bin/docker-compose up --build --wait
# attach to the containers and print logs
ExecStart=/usr/bin/docker-compose up
# prevent docker-compose from bringing down the containers when restarting
RestartKillSignal=SIGKILL

[Install]
WantedBy=multi-user.target
```

Note the exclusion of an `ExecStop`, instead we are relying on the SIGTERM sent when stopping the unit (this will gracefully stop the containers as expected).  
This also lets us use SIGKILL when restarting the unit, which force stops our `docker-compose up` - preventing it from stopping the containers when the service is restarted.

Unfortunately, stopping this way causes docker-compose to terminate with exit code 130, which systemd considers a failure:

```txt
% systemctl stop something
% systemctl status something
× something.service - Some docker compose service
     Loaded: loaded (/usr/lib/systemd/system/something.service; enabled; preset: enabled)
     Active: failed (Result: exit-code) since Wed 2024-05-15 19:42:33 CAT; 54s ago
   Duration: 52.405s
    Process: 77957 ExecStart=/usr/bin/docker-compose up (code=exited, status=130)
   Main PID: 77957 (code=exited, status=130)
        CPU: 1.425s
```

This could be silenced by putting a `-` in front of the command so it reads `ExecStart=-/usr/bin/docker-compose up`.

Alternatively, you could use a bash script to ignore only the 130 exit code:
```bash
#!/usr/bin/env bash
/usr/bin/docker-compose up
exit $(( $? == 130 ? 0 : $? ))
```

And run it from the systemd unit like `ExecStart=/path/to/script.sh`

## A better approach
The exit code shenanigans can be avoided if we used `docker-compose logs` for our main process instead:

```systemd
[Unit]
Description=Some docker compose service
Requires=docker.service
After=docker.service

[Service]
WorkingDirectory=/path/to/project
ExecStartPre=/usr/bin/docker-compose up --build --wait
ExecStart=/usr/bin/docker-compose logs --follow -n 0
ExecStop=/usr/bin/docker-compose down
ExecReload=/usr/bin/docker-compose up --build --wait

[Install]
WantedBy=multi-user.target
```

This has the upside of keeping the expected behaviour of `systemctl restart <service>` ("stop and then start again").

The service can be reloaded using `systemctl reload <service>`. Which will run `ExecReload` without stopping the service beforehand.
