var AWS = require('aws-sdk');
var _ = require('lodash');
var awsConfig = require('./aws-config');
var urljoin = require('url-join');
var csvToJson = require('csvtojson');
var debug = require('debug')('4front:plugins:s3-proxy');

require('simple-errors');

// HTTP headers from the AWS request to forward along
var awsForwardHeaders = ['content-type', 'last-modified', 'etag'];

module.exports = function(options) {
  return function(req, res, next) {
    var s3Params = _.extend(awsConfig(options), _.pick(options, 'endpoint', 's3ForcePathStyle'));
    var s3 = new AWS.S3(s3Params);

    // This will get everything in the path following the mountpath
    var s3Key = req.originalUrl.substr(req.baseUrl.length + 1);

    var s3Options = {
      Bucket: options.bucket,
      Key: options.prefix ? urljoin(options.prefix, s3Key) : s3Key
    };

    if (req.method !== 'GET') return next();

    debug('read s3 object', s3Options.Key);
    var s3Request = s3.getObject(s3Options);

    s3Request.on('httpHeaders', function(statusCode, headers) {
      debug('received httpHeaders');

      if (options.csvToJson === true) {
        headers['content-type'] = 'application/json; charset=utf-8';
      }

      // Get the contentType from the headers
      _.each(awsForwardHeaders, function(header) {
        if (headers[header]) {
          debug('set header %s=%s', header, headers[header]);
          res.set(header, headers[header]);
        }
      });
      debug('done settings httpHeaders');
    });

    debug('read stream %s', s3Options.Key);

    var readStream = s3Request.createReadStream()
      .on('error', function(err) {
        debug('readStream error');
        if (err.code === 'NoSuchKey') {
          return next(Error.http(404, 'Missing S3 key', {code: 'missingS3Key', key: s3Options.key}));
        }
        return next(err);
      });

    if (options.csvToJson === true) {
      var converter = new csvToJson.Converter({constructResult: false});

      var recordsWritten = false;
      converter.on('record_parsed', function() {
        if (recordsWritten) {
          res.write(',');
        } else {
          res.write('[');
          recordsWritten = true;
        }
      });
      converter.on('end_parsed', function() {
        res.write(']');
      });

      readStream = readStream.pipe(converter);
    }

    readStream.pipe(res);
  };
};
