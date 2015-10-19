var AWS = require('aws-sdk');
var _ = require('lodash');
var awsConfig = require('./aws-config');
var urljoin = require('url-join');
var debug = require('debug')('4front:plugins:s3-bridge');

require('simple-errors');

// HTTP headers from the AWS request to forward along
var awsForwardHeaders = ['content-type', 'last-modified', 'etag'];

module.exports = function(options) {
  return function(req, res, next) {
    var s3Params = _.extend(awsConfig(options), _.pick(options, 'endpoint', 'bucket', 's3ForcePathStyle'));
    var s3 = new AWS.S3(s3Params);

    // This will get everything in the path following the mountpath
    var s3Key = req.originalUrl.substr(req.baseUrl.length + 1);

    // debugger;
    var s3Options = {
      Bucket: options.bucket,
      Key: urljoin(options.prefix, s3Key)
    };

    if (req.method !== 'GET') return next();

    debug('read s3 object', s3Options.Key);
    var s3Request = s3.getObject(s3Options);

    s3Request.on('httpHeaders', function(statusCode, headers) {
      debug('received httpHeaders');

      // Get the contentType from the headers
      _.each(awsForwardHeaders, function(header) {
        if (headers[header]) {
          res.set(header, headers[header]);
        }
      });
      debug('done settings httpHeaders');
    });

    debug('read stream %s', s3Options.Key);
    s3Request.createReadStream()
      .on('error', function(err) {
        if (err.code === 'NoSuchKey') {
          return next(Error.http(404, 'Missing S3 key', {code: 'missingS3Key', key: s3Options.key}));
        }
      })
      .pipe(res);
  };
};
