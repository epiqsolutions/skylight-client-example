import fetch from "node-fetch";
import WebSocket from "ws";
import argv from "./args.js";

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
        const survey_id = result.survey_id;
        setTimeout(() => {
          console.log("Five seconds have passed, stopping survey");
          stopSurvey(result.survey_id);
        }, 5000);
      },
      (err) => {
        console.error("ERROR:", err);
        conn.close();
      }
    );
};

const stopSurvey = (survey_id) => {
  fetch(`http://${args.remote}/sklt/survey/${survey_id}/state/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify("stopped"),
  })
    .then((resp) => {
      if (resp.ok) {
        return resp.json();
      }
      return Promise.reject(resp);
    })
    .then(
      (result) => {
        console.log("SURVEY Stopped", result);
        conn.close();
      },
      (err) => {
        console.error("ERROR Stopping survey:", survey_id, err);
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
});

const lteSurvey = {
  one_shot: false,
  rx_port: "J3",
  survey_parameters: [
    {
      tech: "lte",
      type: "band",
      bands: [
        { band: "2", channels: [] },
        { band: "4", channels: [] },
      ],
    },
    {
      tech: "p25",
      type: "frequency-list",
      frequencies_hz: [769806250, 770793750, 773206250, 773718750, 774706250],
    },
  ],
};
