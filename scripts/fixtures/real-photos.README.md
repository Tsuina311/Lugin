# Real-phone scanner photos

Place private validation photos here (this directory is under `.scan-fixtures/`,
which is gitignored).

Each shot needs a PNG and a JSON sidecar with the expected card:

```json
{
  "expectedName": "Sol Ring",
  "scryfallId": "acce65cc-9093-45a6-8c86-97edce545050",
  "tag": "foil-sleeve",
  "imageFile": "sol-ring-sleeve.png"
}
```

Then:

```bash
yarn scan:pipeline:real
```

Do not commit copyrighted card imagery.
