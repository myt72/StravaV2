const PORT = process.env.PORT || 5001;
module.exports = {
  client_id: "270370",
  client_secret: "622fd8682dfc31311c097c6ce4fe39b8c216bfca",
  port: PORT,
  redirect_uri: `http://localhost:${PORT}/exchange_token`
};
