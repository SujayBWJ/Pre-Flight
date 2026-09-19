import "./config/env.js";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const host = "0.0.0.0";
const app = createApp();

app.listen(port, host, () => {
  console.log(`Paytm Pre-Flight listening on ${host}:${port}`);
});