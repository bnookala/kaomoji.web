// server.js

// init project
const SlackClient = require('@slack/client').WebClient;
const express = require('express');
const bodyParser = require('body-parser');
const kao = require('kao.moji');
const low = require('lowdb');
const lowStorage = require('lowdb/lib/storages/file-async');

const db = low('.data/db.json', { storage: lowStorage });
const server = express();

server.use(bodyParser.urlencoded({ extended: true }));

const schema = {
  "tokens": []
}

// Lol. Not secure at all.
db.defaults(schema)
    .write()
    .then(() => {
        server.listen(
            process.env.PORT,
            () => { console.log('listening!'); }
        )
});

server.use('/', express.static('public'));

// Oauth Dance.
server.get('/auth', async (req, res) => {
    const code = req.query.code;
    const slekClient = new SlackClient(process.env.PREAUTH_TOKEN);

    if (!code) {
        console.log("No code");
        res.sendStatus(403);
    }

    slekClient.oauth.access(process.env.SLACK_CLIENT_ID, process.env.SLACK_CLIENT_SECRET, code, {}, oAuthDance);
});

const oAuthDance = async (err, data) => {
    if (err || !data.ok) {
        res.sendStatus(500);
        return;
    }

    const token = data.access_token;
    const teamId = data.team_id;
    const userId = data.user_id;
    const existingData = await db.get("tokens").find({
        teamId: teamId,
        userId: userId}
    ).value();

    if (existingData) {
        res.send("You've already authenticated this application on this team.");
        return;
    }

    // Write the token pair.
    db.get("tokens")
      .push({teamId: teamId, userId: userId, token: token})
      .write()
      .then((tokens) => res.send("Yay! Go ahead and close this window."));
}

// Endpoint to build up a donger!!!
server.post('/kao', async (req, res) => {
    const body = req.body;
    const userId = req.body.user_id;
    const channel = req.body.channel_id;
    const username = req.body.user_name;
    const mood = req.body.text.toLowerCase();
    const teamId = req.body.team_id;
    const teamName = req.body.team_domain;
    const doesMoodExist = kao[mood];

    let slekClient, authedUser;

    try {
        authedUser = await isUserAuthed(userId, teamId);
    } catch (e) {
        console.log(e);
        res.sendStatus(500);
    }

    if (!authedUser) {
        const authLink = getSlekAuthLink(teamName);

        res.send(`Hi. In order to use kao, you will need to log in: ${authLink}`);
        return;
    }

    try {
        slekClient = await getSlekClient(userId, teamId);
    } catch (e) {
        res.sendStatus(500);
    }

    if (!slekClient) {
        console.log("No slek client");
        res.sendStatus(403);
        return;
    }

    // Not from Slek.
    if (req.body.token != process.env.VERIFICATION_TOKEN) {
        console.log("not from slek");
        res.sendStatus(403);
        return;
    }

    // InStRuCtIoNs
    if (mood === "help") {
        const allMoods = kao.moji.available().join(', ');
        // Can't use chat.postEphemeral just yet…
        res.send(
            `Here are all the available moods ~  \n ${allMoods}. \n You can use them like this: \`/kao some-mood\``
        );
        return;
    }

    // Send a private message about unknown moods.
    if (!doesMoodExist) {
        res.send(
            `Hmm… can't seem to find a mood for: ${mood}. Maybe try one of the supported moods here? https://github.com/bnookala/kao.moji#available-moods`
        );

        return;
    }

    const donger = kao.moji[mood]();

    // Get the slack user's photo and try to be them.
    slekClient.users.info(userId, function (error, data) {
        slekClient.chat.postMessage(channel, donger, {as_user: false, username: username, icon_url: data.user.profile.image_32}, function (error, data) {
            error ? console.log(error) : console.log(`Posting donger ${donger} for status: ${data.ok}`);
            res.status(200);
            return;
        });

        res.status(200);
        return;
    });

    res.status(200);
    return;
});


const isUserAuthed = async (userId, teamId) => {
    let userData;

    try {
        userData = await db.get("tokens").find({userId: userId, teamId:teamId}).value();
    } catch (e) {
        console.log('error while checking if authed');
        console.log(e);
        return false;
    }

    if (!userData) {
        return false;
    }

    return true;
}

// Depending on the teamId, get the auth token.
const getSlekClient = async (userId, teamId) => {
    let userData;

    if (!teamId) {
        return null;
    }

    try {
        userData = await db.get("tokens").find({userId:userId, teamId:teamId}).value();
    } catch (e) {
        console.log('error while getting slek client');
        console.log(e);
        return null;
    }

    if (!userData.token) {
        return null;
    }

    return new SlackClient(userData.token);
};

// Generates auth link with team name.
const getSlekAuthLink = (teamName) => {
    return `https://${teamName}.slack.com/oauth/authorize?&client_id=${process.env.SLACK_CLIENT_ID}&scope=commands%2Cbot%2Cchannels%3Aread%2Cchannels%3Awrite%2Cchat%3Awrite%3Abot%2Cusers%3Aread`
}