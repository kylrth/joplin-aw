# joplin-aw

This is a plugin for importing your ActivityWatch logs into a Joplin note in a readable format.

The inspiration for creating this plugin was seeing someone's [meticulous log of how they spent all their time](https://libreddit.oxymagnesium.com/img/3wbisgn88uda1.png) during their PhD.

## usage

Once the plugin is added to Joplin, you can find the `getAWLogs` command in the command palette (`Ctrl + Shift + P`), or find the menu option `Tools -> Insert ActivityWatch logs`. The command writes the information where your cursor is.

The command accepts an optional argument to choose the day to get information for, either by specifying a day offset ("-1" for yesterday, etc.) or a date ("2023-12-25").
