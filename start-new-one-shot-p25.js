import fetch from "node-fetch";
import WebSocket from "ws";
import { argv } from "./args.js";

const args = argv.parse();

const startSurvey = () => {
  fetch(`http://${args.remote}/sklt/survey/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p25Survey),
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

const p25Survey = {
  one_shot: true,
  rx_port: args["rx-port"],
  survey_parameters: [
    {
      tech: "p25",
      type: "frequency-list",
      frequencies_hz: [769806250, 770793750, 773206250, 773718750, 774706250],
    },
  ],
};
