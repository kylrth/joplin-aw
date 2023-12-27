# JoplinAW

This is a plugin for importing your ActivityWatch logs into a Joplin note in a readable format.

The inspiration for creating this plugin was seeing someone's [meticulous log of how they spent all their time](https://www.reddit.com/r/PhD/comments/10jjvg0/how_i_spent_every_minute_of_my_phd/) during their PhD.

You can install this plugin in Joplin by going to `Tools -> Options`, clicking Plugins, and searching for JoplinAW.

## usage

Once the plugin is added to Joplin, you can find the `getAWLogs` command in the command palette (`Ctrl + Shift + P`), or find the menu option `Tools -> Insert ActivityWatch logs`. The command writes the information where your cursor is.

The command accepts an optional argument to choose the day to get information for, either by specifying a day offset ("-1" for yesterday, etc.) or a date ("2023-12-25").

Running the `getAWLogs` command pastes a summary of app usage for every 15 minute period in which the user was active during the specified day. Here's an example of what that might look like:

```
- **09:51**
    - 7:12: Signal: Signal
    - 5:04: Joplin: Joplin
    - 1:36: VSCodium: build.yml - joplin-aw
    - 0:39: Firefox: actions/upload-artifact
    - 0:05: Signal: Signal (1)
    - 0:01: Signal: Signal (2)
    - 0:00: Wrapper-2.0: Whisker Menu
- **10:06**
    - 13:45: Signal: Signal
    - 2:50: Joplin: Joplin
    - 2:06: Firefox: ChatGPT
    - 0:42: VSCodium: build.yml - joplin-aw
    - 0:23: Firefox: actions/upload-artifact
    - 0:02: Firefox
    - 0:01: Signal: Signal (1)
    - 0:00: Signal: Signal (2)
    - 0:00: Wrapper-2.0: Whisker Menu
- **10:21**
    - 7:35: Firefox: ChatGPT
    - 1:57: Signal: Signal
    - 0:16: Signal: Signal (2)
    - 0:12: Signal: Signal (1)
    - 0:01: Firefox: actions/upload-artifact
    - 0:00: Firefox
- **10:36**
    - 4:57: Firefox: kylrth/joplin-aw: Import your daily ActivityWatch logs to Joplin
    - 3:42: Firefox: Getting started with plugin development | Joplin
    - 1:32: VSCodium: index.js - joplin-aw
    - 1:16: Firefox: release plugin builds for tags · kylrth/joplin-aw@565935b
    - 1:15: VSCodium: build.yml (Working Tree) (build.yml) - joplin-aw
    - 1:15: Joplin: Joplin - Options
    - 0:24: Joplin: Joplin
    - 0:20: VSCodium: release.yml - joplin-aw
    - 0:10: VSCodium: build.yml - joplin-aw
    - 0:06: Firefox: ChatGPT
    - 0:03: Firefox: build outside Docker · kylrth/joplin-aw@b9a4f5b
    - 0:01: Signal: Signal
    - 0:01: VSCodium: manifest.json - joplin-aw
    - 0:00: Wrapper-2.0: Whisker Menu
    - 0:00: Firefox: actions/upload-artifact
    - 0:00: Firefox: nitter/.github/workflows/build-docker.yml at master · zedeus/nitter
```

Currently the 15-minute period is not modifiable, but I might change that later. Feel free to provide feedback by opening an issue here!
