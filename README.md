# Better Tables (Please)

If you are frustrated with making tables in your notes, install this. Summon the interactive table via the ```Table``` block. Just drag to resize and reorder, hover to insert, click to edit.

<img alt="Better Tables" src="https://github.com/user-attachments/assets/bb4daa93-479e-4f30-8520-eeb226110711" />

## Features

- **Click to edit** any cell, with `Tab` / `Enter` to move between cells
- **Drag dividers** to resize columns and rows
- **Drag the edge handles** to reorder columns and rows
- **Hover insert dots** to add a column or row between any two
- **Select + delete** a row or column (click its handle, then `Delete`)
- **Add** columns and rows from the `+` pills on the right and bottom edges
- Horizontal scrolling for wide tables
- Column widths and row heights are remembered

## Usage

Add a `table` code block:

Then, go to the next line, and you'd summon the interactive/visial table tool. 

Or run the **Better Tables: Insert table** command from the command palette.

Column/row sizes are stored in a small trailing comment inside the block (e.g. `<!-- tk:cols=140,140;rows=48,48 -->`); the table itself stays valid Markdown.

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Copy them into `<your-vault>/.obsidian/plugins/better-tables/`.
3. Reload Obsidian and enable **Better Tables** under Settings → Community plugins.

## License

[MIT](LICENSE)

Happy noting! 
Yaye
