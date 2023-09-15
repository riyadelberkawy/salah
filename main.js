const express = require("express"); // require expressjs
const compression = require("compression"); // compress stream
const bodyparser = require("body-parser"); // bodyparser
const path = require("path"); // and path

// then require our praytimes libary
const praytimes = require("./lib/praytimes.js");

// init app
var app = express();

const fs = require("fs").promises;
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Lists the next 10 events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listEvents(auth) {
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: "startTime",
  });
  const events = res.data.items;
  if (!events || events.length === 0) {
    console.log("No upcoming events found.");
    return;
  }
  console.log("Upcoming 10 events:");
  events.map((event, i) => {
    const start = event.start.dateTime || event.start.date;
    console.log(`${start} - ${event.summary}`);
  });
}

authorize().then(listEvents).catch(console.error);

function calc(config, lat, lng, timezone) {
  // init class
  var times = new praytimes();
  var methods = times.getMethods();

  // set default configuration
  var params = methods["MWL"];

  // get date
  var date = new Date();

  // select method (params)
  if (typeof methods[config.method] === "object") {
    params = methods[config.method].params;
  } else {
    // override method
    config.method = "MWL";
  }

  // parse date if needed
  if (config.date) {
    var parsed = Date.parse(config.date);

    if (isNaN(config.date) && !isNaN(parsed)) {
      date = new Date(parsed);
    }
  }

  // configure object
  times.adjust(params);

  // calculate times
  var pt = times.getTimes(date, [lat, lng], timezone);

  return {
    method: config.method,
    date: date,
    pt: pt,
  };
}

// set view engine to pug
app.set("view engine", "pug");

// use static path
app.use(express.static(path.join(__dirname + "/public/")));

// use middleware
app.use(bodyparser.urlencoded({ extended: true }));
app.use(compression({ level: 1 }));

// set headers and log request
app.use((req, res, next) => {
  // set headers
  res.header("Server", "Enterprise");
  res.header("X-Powered-By", "slowmo");
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );

  // force https
  if (
    req.headers["x-forwarded-proto"] != "https" &&
    process.env["FORCEHTTPS"]
  ) {
    res.redirect(302, "https://" + req.hostname + req.originalUrl);
  }
  // and continue
  next();
});

// index page
app.get("/", (req, res) => {
  // get varibles from url query
  var lat = req.query.lat;
  var lng = req.query.lng;
  var timezone = req.query.timezone;

  // check if they're numbers
  if (isNaN(lat) || isNaN(lng) || isNaN(timezone)) {
    // latitude and longitude are not numbers (or timezone)
    // if not set status code to 500
    status_code = 500;
  }

  // else convert them into numbers
  lat = Number(lat);
  lng = Number(lng);
  timezone = Number(timezone);

  var { method, date, pt } = calc(req.query, lat, lng, timezone);

  res.render("index", pt);
});

// api requests
app.get("/api/:lat/:lng/:timezone", (req, res) => {
  // set status code
  var status_code = 200;

  // get varibles from url string
  var lat = req.params.lat;
  var lng = req.params.lng;
  var timezone = req.params.timezone;

  // check if they're numbers
  if (isNaN(lat) || isNaN(lng) || isNaN(timezone)) {
    // latitude and longitude are not numbers (or timezone)
    // if not set status code to 500
    status_code = 500;
  }

  // else convert them into numbers
  lat = Number(lat);
  lng = Number(lng);
  timezone = Number(timezone);

  // calculate times
  var { method, date, pt } = calc(req.query, lat, lng, timezone);

  // check if the times were calculated correctly
  if (pt.fajr === "-----") {
    status_code = 500;
  }

  // send response object
  res.status(status_code).send({
    date: date.toDateString(),
    status: status_code,
    timezone: timezone,
    method: method,
    coordinates: {
      latitude: lat,
      longitude: lng,
    },
    times: pt,
  });
});

// write a function to create google calendar events from the prayer times
// https://developers.google.com/calendar/quickstart/nodejs
app.get("/api/:lat/:lng/:timezone/calendar", async (req, res) => {
  // set status code

  // set status code
  var status_code = 200;

  // get varibles from url string
  var lat = req.params.lat;
  var lng = req.params.lng;
  var timezone = req.params.timezone;

  // check if they're numbers
  if (isNaN(lat) || isNaN(lng) || isNaN(timezone)) {
    // latitude and longitude are not numbers (or timezone)
    // if not set status code to 500
    status_code = 500;
  }

  // else convert them into numbers
  lat = Number(lat);
  lng = Number(lng);
  timezone = Number(timezone);
  const events = await getEvents(req, lat, lng, timezone);

  console.log(events);
  console.log(events?.length);

  const { google } = require("googleapis");

  await authorize().then(async (auth) => {
    console.log("authorized");
    const calendar = google.calendar({ version: "v3" });

    for (const event of events) {
      await sleep(5000);
      calendar.events.insert(
        {
          calendarId: "primary",
          auth: auth,
          resource: event,
        },
        function (err, res) {
          if (err) {
            console.log(
              "There was an error contacting the Calendar service: " + err
            );
            return;
          }
          console.log("Event created: %s", res.data);
        }
      );
      await sleep(10000);
    }
  });

  // send response object
  res.status(status_code).send({
    date: "week",
    status: status_code,
    timezone: timezone,
    coordinates: {
      latitude: lat,
      longitude: lng,
    },
    events,
  });
});

// set port
var port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log("Listening on port", port);
});

// functions to wait for the promise to resolve
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const getEvents = async (req, lat, lng, timezone) => {
  return new Promise((resolve, reject) => {
    // loop for 1 week
    const dates = [...Array(7).keys()].reduce((acc, i, index) => {
      const lastDate = acc[acc.length - 1];
      const date = lastDate ? new Date(lastDate) : new Date();
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);
      return [...acc, nextDate];
    }, []);

    let events = [];
    console.log("dates", dates);
    for (const dateD of dates) {
      var { method, date, pt } = calc(
        { ...req.query, date: dateD.toISOString() },
        lat,
        lng,
        timezone
      );
      console.log("date", date);
      console.log("pt", pt);
      const DateEvents = Object.values(pt).map((time, i) => {
        const startTime = time; // 5:00
        const endTime = time; // 5:30
        const startDateTime = new Date(date);
        const endDateTime = new Date(date);
        startDateTime.setHours(startTime.split(":")[0]);
        startDateTime.setMinutes(startTime.split(":")[1]);
        endDateTime.setHours(endTime.split(":")[0]);
        endDateTime.setMinutes(endTime.split(":")[1]);
        // add 30 minutes to end time
        endDateTime.setMinutes(endDateTime.getMinutes() + 30);

        return {
          summary: Object.keys(pt)[i],
          start: {
            dateTime: startDateTime.toISOString(),
            timeZone: "GMT+03:00",
          },
          end: {
            dateTime: endDateTime.toISOString(),
            timeZone: "GMT+03:00",
          },
          // reminders 10 minutes before
          reminders: {
            useDefault: false,
            overrides: [{ method: "popup", minutes: 7 }],
          },
          // color green sage
          colorId: 2,
        };
      });
      events = [...events, ...DateEvents];
    }
    resolve(events);
  });
};
