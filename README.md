# arr-images

Radarr, Sonarr and Lidarr images (bdelima/radarr, bdelima/sonarr, bdelima/lidarr) where every scheduled-task interval can be overridden from a properties file in /config. A small patch to upstream's TaskManager, overlaid on the LinuxServer images and rebuilt for each upstream release.

## Releasing

Releases are cut by the code session only: bump `VERSION` in a reviewed PR
and merge it; the release workflow does the rest. Changes reach `main` only
through pull requests.
