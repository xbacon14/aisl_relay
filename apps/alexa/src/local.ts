/**
 * Local HTTPS-less endpoint for quick iteration. Alexa itself cannot call this
 * (needs HTTPS + signature check); use it with a tunnel (ngrok/cloudflared) or
 * just run `npm run smoke -w @relay/alexa` against the mock.
 *
 *   npm run mock                      # terminal 1
 *   RELAY_API_URL=http://localhost:3000 npm run dev:alexa   # terminal 2
 *   curl -s localhost:3978/alexa -d @fixtures/launch.json -H 'content-type: application/json'
 */
import express from "express";
import { skillBuilder } from "./handlers.js";

const skill = skillBuilder.create();
const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true, app: "relay-alexa" }));
app.post("/alexa", async (req, res) => {
  try {
    const out = await skill.invoke(req.body);
    res.json(out);
  } catch (err) {
    console.error("[relay alexa] invoke failed", err);
    res.status(500).json({ error: String(err) });
  }
});
const port = Number(process.env.ALEXA_PORT ?? 3978);
app.listen(port, () => console.log(`[relay alexa] local endpoint http://localhost:${port}/alexa → ${process.env.RELAY_API_URL}`));
