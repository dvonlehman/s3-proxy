var AWS = require('aws-sdk');
var _ = require('lodash');
var awsConfig = require('aws-config');
var urljoin = require('url-join');
var mime = require('mime');
var csvToJson = require('csvtojson');
var debug = require('debug')('4front:plugins:s3-proxy');

require('simple-errors');

// HTTP headers from the AWS request to forward along
var awsForwardHeaders = ['content-type', 'last-modified', 'etag', 'cache-control'];

module.exports = function(options) {
  return function(req, res, next) {
    if (req.method !== 'GET') return next();

    var s3Params = _.extend(awsConfig(options), _.pick(options, 'endpoint', 's3ForcePathStyle'));
    var s3 = new AWS.S3(s3Params);

    // This will get everything in the path following the mountpath
    var s3Key = req.originalUrl.substr(req.baseUrl.length + 1);

    // Strip out any path segments that start with a double dash '--'. This is just used
    // to force a cache invalidation.
    s3Key = _.reject(s3Key.split('/'), function(segment) {
      return segment.slice(0, 2) === '--';
    }).join('/');

    var s3Options = {
      Bucket: options.bucket,
      Key: options.prefix ? urljoin(options.prefix, s3Key) : s3Key
    };

    if (req.headers['if-none-match']) {
      s3Options.IfNoneMatch = req.headers['if-none-match'];
    }

    debug('read s3 object', s3Options.Key);
    var s3Request = s3.getObject(s3Options);

    s3Request.on('httpHeaders', function(statusCode, s3Headers) {
      debug('received httpHeaders');

      // Get the contentType from the headers
      _.each(awsForwardHeaders, function(header) {
        var headerValue = s3Headers[header];

        if (header === 'content-type') {
          if (options.csvToJson === true) {
            headerValue = 'application/json; charset=utf-8';
          } else if (headerValue === 'application/octet-stream') {
            // If the content-type from S3 is the default "application/octet-stream",
            // try and get a more accurate type based on the extension.
            headerValue = mime.lookup(req.path);
          }
        } else if (header === 'cache-control') {
          if (options.overrideCacheControl) {
            debug('override cache-control to', options.overrideCacheControl);
            headerValue = options.overrideCacheControl;
          } else if (!headerValue && options.defaultCacheControl) {
            debug('default cache-control to', options.defaultCacheControl);
            headerValue = options.defaultCacheControl;
          }
        }

        if (headerValue) {
          debug('set header %s=%s', header, headerValue);
          res.set(header, headerValue);
        }
      });
    });

    debug('read stream %s', s3Options.Key);

    var readStream = s3Request.createReadStream()
      .on('error', function(err) {
        debug('readStream error');
        // If the code is PreconditionFailed and we passed an IfNoneMatch param
        // the object has not changed, so just return a 304 Not Modified response.
        if (err.code === 'NotModified' || (err.code === 'PreconditionFailed' && s3Options.IfNoneMatch)) {
          return res.status(304).end();
        }
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
