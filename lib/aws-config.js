var _ = require('lodash');
var AWS = require('aws-sdk');

module.exports = function(options) {
  var awsOptions = _.pick(options, 'accessKeyId', 'secretAccessKey',
    'region', 'httpOptions', 'sslEnabled', 'timeout');

  if (!awsOptions.httpOptions) awsOptions.httpOptions = {};

  // Ensure that the passed in options cannot exceed system level limits
  // if (_.isNumber(req.app.settings.networkTimeout)) {
  //   if (!options.timeout || options.timeout > req.app.settings.networkTimeout) {
  //     options.timeout = req.app.settings.networkTimeout;
  //   }
  // }

  if (options.timeout) {
    awsOptions.httpOptions.timeout = options.timeout;
  }

  if (options.profile) {
    awsOptions.credentials = new AWS.SharedIniFileCredentials({
      profile: options.profile
    });
    delete awsOptions.profile;
  }

  // Configure the proxy
  if (process.env.HTTPS_PROXY && awsOptions.sslEnabled !== false) {
    if (!awsOptions.httpOptions.agent) {
      var HttpsProxyAgent = require('https-proxy-agent');
      awsOptions.httpOptions.agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
    }
  }

  return awsOptions;
};
