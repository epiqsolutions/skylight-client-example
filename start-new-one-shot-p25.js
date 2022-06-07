import fetch from "node-fetch";
import WebSocket from "ws";
import { argv } from "./args.js";

const args = argv.parse();

const startSurvey = () => {
  fetch(`http://${args.remote}/sklt/survey/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lteSurvey),
  })
    .then((resp) => {
      if (resp.ok) {
        return resp.json();
      }
      return Promise.reject(resp);
    })
    .then(
      (result) => {
        console.log("SURVEY Started", result);
      },
      (err) => {
        console.error("ERROR:", err);
        conn.close();
      }
    );
};

const conn = new WebSocket(`ws://${args.remote}/events/`, ["sklt"]);
conn.on("open", () => {
  console.log("CONNECTED to WS");
  startSurvey();
});
conn.on("close", () => {
  console.error("DISCONNECTED from WS");
});
conn.on("message", (msg) => {
  console.log("MSG: %s", msg);
  const parsed = JSON.parse(msg);
  if (parsed.data.type === "endofscan") {
    conn.close();
  }
});

const lteSurvey = {
  // one_shot: true,
  rx_port: "Jxxx_RX1",
  survey_parameters: [
    // {
    //   tech: "lte",
    //   type: "band",
    //   bands: [
    //     { band: "2", channels: [] },
    //     { band: "4", channels: [] },
    //     { band: "5", channels: [] },
    //     { band: "7", channels: [] },
    //     { band: "12", channels: [] },
    //     { band: "13", channels: [] },
    //     { band: "14", channels: [] },
    //     { band: "17", channels: [] },
    //     { band: "20", channels: [] },
    //     { band: "25", channels: [] },
    //     { band: "26", channels: [] },
    //     { band: "29", channels: [] },
    //     { band: "30", channels: [] },
    //     { band: "40", channels: [] },
    //     { band: "41", channels: [] },
    //     { band: "42", channels: [] },
    //     { band: "48", channels: [] },
    //     { band: "66", channels: [] },
    //     { band: "71", channels: [] },
    //   ],
    // },
    {
      tech: "p25",
      type: "frequency-list",
      frequencies_hz: [769806250, 770793750, 773206250, 773718750, 774706250],
    },
  ],
};
