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
      },
      (err) => {
        console.error("ERROR:", err);
      }
    );
};

const lteSurvey = {
  one_shot: false,
  rx_port: args["rx-port"],
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

startSurvey();
