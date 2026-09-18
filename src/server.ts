import "./config/env.js";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`Paytm Pre-Flight backend listening on port ${port}`);
});