all: dist

IMG_NAME=local/generator-joplin:latest
PWD=$(shell pwd)
USER=$(shell id -u):$(shell id -g)
DOCKER_RUN=docker run -u $(USER) -v $(PWD):/home/node/app

# build Joplin plugin dev image
.PHONY: docker-image
docker-image:
	docker build -t $(IMG_NAME) .

# set up new Joplin plugin (only needed once)
.PHONY: setup-env
setup-env: docker-image
	$(DOCKER_RUN) -it $(IMG_NAME) yo joplin

# install project dependencies
node_modules: docker-image package.json package-lock.json
	$(DOCKER_RUN) $(IMG_NAME) npm install --ignore-scripts

# update plugin framework
.PHONY: node-update
node-update:
	$(DOCKER_RUN) $(IMG_NAME) npm run update

# build plugin
dist: node_modules
	$(DOCKER_RUN) $(IMG_NAME)

# run the built plugin. The first time, you will need to add the path to this repo on your machine
# to the "Development plugins" field in the Plugins options, under "Show Advanced Settings". From
# then on, it will load the plugin anew each time this is run.
.PHONY: run
run:
	flatpak run --branch=stable --arch=x86_64 --command='joplin-desktop' --file-forwarding net.cozic.joplin_desktop --env dev
