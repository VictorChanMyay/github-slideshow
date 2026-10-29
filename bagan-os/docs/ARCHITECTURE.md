# Architecture

```
 Apps         Firefox | LibreOffice | VLC | Zawgyi converter | Welcome app
 Desktop      XFCE + Burmese theme and defaults
 Input/Text   Fcitx5 or iBus (Myanmar engines), HarfBuzz shaping, Noto/Padauk fonts
 Installer    Calamares (Burmese)
 Base         Debian stable (apt, systemd, security updates)
 Kernel       Linux (unchanged)
```

## Decisions

| Area | Choice | Why |
|---|---|---|
| Base | Debian stable | Stability, huge package pool, free-software policy |
| Desktop | XFCE | Runs well on old hardware; GNOME/KDE editions later |
| Build | live-build | Reproducible, scriptable, CI friendly |
| Installer | Calamares | Translatable, simple UX |
| Text | Unicode only | Zawgyi causes data corruption and search failures |
| Updates | Debian security + own repo | Don't maintain a fork of everything |

## Design principles
1. Burmese works out of the box, with no manual setup.
2. Upstream first: contribute fixes to existing projects.
3. Offline first: assume slow or expensive internet.
4. Minimal fork: customize through packages and config, not patches.
5. Low spec: a machine with 2 GB RAM and an older 64-bit CPU should be usable.
