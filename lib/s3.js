var AWS = require('aws-sdk');
var _ = require('lodash');
var awsConfig = require('aws-config');
var urljoin = require('url-join');
var mime = require('mime');
var debug = require('debug')('s3-proxy');

require('simple-errors');

// HTTP headers from the AWS request to forward along
var awsForwardHeaders = ['content-type', 'last-modified', 'etag', 'cache-control'];

module.exports = function(options) {
  var s3 = new AWS.S3(_.extend(awsConfig(options), _.pick(options, 'endpoint', 's3ForcePathStyle')));

  function listKeys(req, res, next) {
    var folderPath = req.originalUrl.substr(req.baseUrl.length);

    var s3Params = {
      Bucket: options.bucket,
      Prefix: options.prefix ? urljoin(options.prefix, folderPath) : folderPath
    };

    debug('list s3 keys at', s3Params.Prefix);
    s3.listObjects(s3Params, function(err, data) {
      if (err) {
        return next(Error.create('Could not read S3 keys', {
          prefix: s3Params.prefix,
          bucket: s3Params.bucket
        }, err));
      }

      var keys = [];
      _.map(data.Contents, 'Key').forEach(function(key) {
        // Chop off the prefix path
        if (key !== s3Params.Prefix) {
          if (_.isEmpty(s3Params.Prefix)) {
            keys.push(key);
          } else {
            keys.push(key.substr(s3Params.Prefix.length));
          }
        }
      });

      res.json(keys);
    });
  }

  function getObject(req, res, next) {
    // This will get everything in the path following the mountpath
    var s3Key = req.originalUrl.substr(req.baseUrl.length + 1);

    // Chop off the querystring, it causes problems with SDK.
    var queryIndex = s3Key.indexOf('?');
    if (queryIndex !== -1) {
      s3Key = s3Key.substr(0, queryIndex);
    }

    // Strip out any path segments that start with a double dash '--'. This is just used
    // to force a cache invalidation.
    s3Key = _.reject(s3Key.split('/'), function(segment) {
      return segment.slice(0, 2) === '--';
    }).join('/');

    var s3Params = {
      Bucket: options.bucket,
      Key: options.prefix ? urljoin(options.prefix, s3Key) : s3Key
    };

    if (req.headers['if-none-match']) {
      s3Params.IfNoneMatch = req.headers['if-none-match'];
    }

    debug('read s3 object', s3Params.Key);
    var s3Request = s3.getObject(s3Params);

    s3Request.on('httpHeaders', function(statusCode, s3Headers) {
      debug('received httpHeaders');

      // Get the contentType from the headers
      _.each(awsForwardHeaders, function(header) {
        var headerValue = s3Headers[header];

        if (header === 'content-type') {
          if (headerValue === 'application/octet-stream') {
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

    debug('read stream %s', s3Params.Key);

    var readStream = s3Request.createReadStream()
      .on('error', function(err) {
        debug('readStream error');
        // If the code is PreconditionFailed and we passed an IfNoneMatch param
        // the object has not changed, so just return a 304 Not Modified response.
        if (err.code === 'NotModified' || (err.code === 'PreconditionFailed' && s3Params.IfNoneMatch)) {
          return res.status(304).end();
        }
        if (err.code === 'NoSuchKey') {
          return next(Error.http(404, 'Missing S3 key', {code: 'missingS3Key', key: s3Params.key}));
        }
        return next(err);
      });

    readStream.pipe(res);
  }

  return function(req, res, next) {
    if (req.method !== 'GET') return next();

    if (req.path.slice(-1) === '/') {
      listKeys(req, res, next);
    } else {
      getObject(req, res, next);
    }
  };
};
