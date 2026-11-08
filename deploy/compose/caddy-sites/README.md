One `*.caddy` file per application, written by `provision-app.sh`.

Nothing in this directory is edited by hand and nothing here is committed —
`.gitignore` excludes `*.caddy` so a domain name and its routing never arrive
in the repository by accident. `../caddy-site.template` is what gets rendered.
