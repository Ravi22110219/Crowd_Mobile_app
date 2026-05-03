const { createCaptcha, json } = require('../shared/http');

exports.handler = async () => {
  return json(200, createCaptcha());
};
