# Myanmar OS (working title)

A free, open-source **desktop operating system for Myanmar users**: Burmese-first, Unicode-only, light enough for old hardware, and useful offline.

> Working title: `TBD`. See [docs/NAMING.md](docs/NAMING.md).

## Approach

We do **not** write a kernel. We build a **Debian-based Linux distribution** with deep Burmese localization:

- Unicode-only (no Zawgyi), with a built-in Zawgyi → Unicode converter
- Burmese fonts, keyboard layouts and input method configured by default
- Burmese installer, welcome app and documentation
- XFCE desktop: fast on low-spec machines
- Offline-first: bundled apps, docs and Burmese Wikipedia

## Repository layout

| Path | Purpose |
|---|---|
| `build/` | Debian `live-build` configuration that produces the ISO |
| `docs/ROADMAP.md` | Staged plan and milestones |
| `docs/ARCHITECTURE.md` | Technical blueprint |
| `docs/NAMING.md` | How we pick a name |
| `../.github/workflows/myanmar-os-build-iso.yml` | Builds the ISO in CI |

## Build locally (Debian/Ubuntu host)

```sh
sudo apt install live-build
cd build
sudo lb config   # runs auto/config
sudo lb build
```

The result is `live-image-amd64.hybrid.iso`. Test it in VirtualBox or QEMU first.

## Contributing

Needed: packagers, Burmese translators, designers, testers on real hardware, and teachers/community organizers. Open an issue to say hello.

License: GPL-3.0-or-later for original work; packages keep their own licenses.
