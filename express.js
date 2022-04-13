// Same as consoleUtils.js, but as an express server

// Create a new express server
const express = require('express')
const app = express()

// The server requires authentication using bearer token from an environment variable
app.all('*', ({ headers: { authorization } }, res, next) =>
  authorization != process.env.AUTH_TOKEN ?
    res.status(401).send('Unauthorized') :
    next()
)


// Endpoint to start hourly routine
let interval
app.get('/start', async (req, res) => {

  interval && clearInterval(interval),
  interval = setInterval(dailyRoutine, 1000 * 60 * 60),
  res.send(interval)

})

// Endpoint to stop hourly routine
app.get('/stop', async (req, res) => {
  
  interval && clearInterval(interval),
  res.send(interval)

})

async function dailyRoutine() {
  
    