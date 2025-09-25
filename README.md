## BANOSSER — The Nano Banana Processor

Turn a list of product images into clean, professional 16:9 studio shots suitable for web cards. Banosser extracts the product from the provided image, places it on a background with soft, realistic lighting, and preserves product fidelity (shape/label) while removing noise and distractions.

### Why
- **Inspiration**: A friend needed better-looking images for a learning project. He provided a dataset; I used it to learn and build a small, practical pipeline.
- **Approach**: Two backends built around Google’s image models:
  - **Google GenAI SDK** (direct)
  - **OpenRouter** (proxies Google models)
- **Cost**: In my testing, processing was about **$0.04 per image**.
- **Key learning**: For multimodal prompts, supplying a background image (for aspect ratio/composition reference) dramatically improves success for 16:9 output.

### What it does
1. Reads a JSONL file of products (brand, name, imageUrl).
2. Downloads the source image to `working/`.
3. Optionally uses `bg.png` as a background reference for composition and aspect ratio.
4. Calls the selected model to produce a widescreen 16:9 image with soft, even lighting and realistic reflections/shadows.
5. Writes final images to `final/` and an index to `final/data.json`.

### Project layout
- `index.js`: Small Ink TUI to choose backend and optional batch size.
- `scripts/process_images.js`: Direct Google GenAI SDK workflow.
- `scripts/process_images_openrouter.js`: OpenRouter workflow.
- `fragrances_with_images_fast.jsonl`: Input dataset (JSON Lines).
- `bg.png` (optional): Background reference image.
- `working/` and `final/`: Staging and outputs.

### Requirements
- Node.js 18+ (required for global `fetch` used by OpenRouter path)
- pnpm 10+
- Environment variables (use a local `.env`):
  - `GOOGLE_API_KEY` (required for the Google GenAI SDK path)
  - `OPENROUTER_API_KEY` (required for the OpenRouter path)

### Install
```bash
pnpm install
```

### Input format (JSONL)
Each line is an object with at least `imageUrl`; `brand` and `name` are recommended.
```json
{"brand":"Afnan","name":"9am","imageUrl":"https://example.com/afnan-9am.jpg"}
```
Place the file at the project root as `fragrances_with_images_fast.jsonl`.

### Optional background image
Add a `bg.png` at the project root. Including this significantly improves consistent 16:9 composition and lighting adherence.

### Usage
You can run via the TUI or call the scripts directly.

- TUI (choose backend and optional batch size):
```bash
pnpm start
```

- Direct (Google GenAI SDK):
```bash
pnpm run process:images -- --limit 25
```

- Direct (OpenRouter):
```bash
pnpm run process:images:openrouter -- --limit 25
```

Notes:
- `--limit` is optional; omit to process all records.
- Outputs are written to `final/`.

### Outputs
- `final/*.jpg`: Enhanced 16:9 product images.
- `final/data.json`: Array of records including original fields plus `localUpdatedFile`.
```json
[
  {
    "brand": "Afnan",
    "name": "9am",
    "imageUrl": "https://example.com/afnan-9am.jpg",
    "localUpdatedFile": "final/Afnan_9am.jpg"
  }
]
```

### Prompting & quality tips
- Provide `bg.png` to anchor aspect ratio and lighting intent.
- Keep instructions explicit about preserving product geometry and label.
- Ask for soft, diffused lighting with realistic reflections and gentle shadows.
- Emphasize 16:9 framing and no stretching; extend background canvas as needed.

### Data and licensing note
This project was a learning exercise. The dataset I used originated from `fragrantica.com`. I’m unsure of their licensing and meant no harm—this was purely for testing AI skills. Please ensure you have the right to use any data you process.

### License
This project is licensed under the [ISC License](./LICENSE).
