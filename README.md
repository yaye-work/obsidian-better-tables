# Better Tables (Please)

If you are frustrated with making tables in your notes, install this. Summon the interactive table via the ```Table``` block. Just drag to resize and reorder, hover to insert, click to edit.
<img alt="bettertables" src="https://github.com/user-attachments/assets/fccec811-d59e-4aca-bf2b-3ec37177494b" />

## Features

- **Click a cell to select it. Click again to edit.** (Or turn on "Quick text edit" to edit with one click.)
- **Move around with the keyboard.** Use the arrow keys, or `Tab` and `Enter`.
- **Press `Enter` on a selected cell** to start editing it.
- **Drag across cells** to select a block. Then copy it, or press `Delete` to clear it.
- **Drag the lines** between rows and columns to resize them.
- **Drag the handles** on the top and left edges to reorder rows and columns.
- **Hover between cells** and click the dot to insert a row or column.
- **Click the `+` buttons** on the right and bottom to add a row or column.
- **Right-click a cell** to align its column left, center, or right.
- **Add a line break inside a cell** with `Shift+Enter`.
- **Delete the whole table** with the trash button in the top corner.
- Wide tables scroll sideways. Your column widths and row heights are saved.

## Usage

1. Add a code block with the word `table`, like this:

````
```table
```
````

Go to the next line, you'd summoned you interactive table.

2. run the **Better Tables: Insert table** command from the command palette.

3. If you have ````slash commander```` core plugin installed, you can use ````/better tables````

Your table is saved as a normal Markdown table, so it still works everywhere else. Column widths and row heights are kept in a small hidden comment inside the block (e.g. `<!-- tk:cols=140,140;rows=48,48 -->`).

## Settings
If you like to immediately select & edit text (bypassing having to select the cell first), you can turn on ````Quick text edit```` in the setting.

## Installation
Add to Obsidian https://community.obsidian.md/plugins/better-tables

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Copy them into `<your-vault>/.obsidian/plugins/better-tables/`.
3. Reload Obsidian and enable **Better Tables** under Settings → Community plugins.

## License

[MIT](LICENSE)

## Support

Thank you for using Better Tables! If you run into a bug or have an idea, please [open an issue](https://github.com/yaye-work/obsidian-better-tables/issues). Feature requests and bug reports are very welcome.

And if you like Better Tables, you can [buy me a coffee ☕](https://buymeacoffee.com/yaye.work). It's genuinely appreciated.

Happy noting! 
Yaye
