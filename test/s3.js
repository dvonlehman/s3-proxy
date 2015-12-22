/* eslint no-console: 0 */

var _ = require('lodash');
var http = require('http');
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var urljoin = require('url-join');
var express = require('express');
var supertest = require('supertest');
var debug = require('debug')('s3-proxy:test');

require('simple-errors');
require('dash-assert');

var BUCKET_NAME = 's3-bucket';

var S3_PORT = 9999;
var S3_OPTIONS = {
  bucket: BUCKET_NAME,
  region: 'us-west-2',
  accessKeyId: '123',
  secretAccessKey: 'abc',
  endpoint: 'http://localhost:' + S3_PORT,
  sslEnabled: false,
  s3ForcePathStyle: true
};

describe('S3Storage', function() {
  var self;

  beforeEach(function(done) {
    self = this;

    this.app = express();
    this.s3 = express();
    this.pluginOptions = _.extend({}, S3_OPTIONS);

    this.s3.use(function(req, res, next) {
      debug('request to fake S3 server', req.url);
      next();
    });

    this.app.use('/s3-proxy', function(req, res, next) {
      require('../lib/s3')(self.pluginOptions)(req, res, next);
    });

    this.app.use(function(err, req, res, next) {
      if (!err.status) err.status = 500;

      if (err.status === 500) {
        console.log(Error.toJson(err));
      }

      res.status(err.status).json(Error.toJson(err));
    });

    this.s3Server = http.createServer(this.s3).listen(S3_PORT, function() {
      debug('fake s3 server listening');
      done();
    });
  });

  afterEach(function() {
    if (this.s3Server) {
      this.s3Server.close();
    }
  });

  it('returns existing json file', function(done) {
    var jsonFile = [
      {
        'name': 'joe',
        'age': 45
      },
      {
        'name': 'sam',
        'age': 61
      }
    ];

    var prefix = 'datadumps';
    var etag = 'asdfasdfasdf';
    var key = urljoin('subfolder', 'data.json');

    this.pluginOptions = _.extend({}, S3_OPTIONS, {
      prefix: prefix
    });

    this.s3.get('/' + BUCKET_NAME + '/' + prefix + '/' + key, function(req, res, next) {
      res.set('etag', etag);
      res.json(jsonFile);
    });

    supertest(self.app)
      .get(urljoin('/s3-proxy', key))
      .expect(200)
      .expect('content-type', 'application/json; charset=utf-8')
      .expect('etag', etag)
      .expect(function(res) {
        assert.deepEqual(res.body, jsonFile);
      })
      .end(done);
  });

  it('returns 404 for missing file', function(done) {
    this.s3.use(function(req, res, next) {
      debug('return 404 error');
      sendS3Error(res, 404, 'NoSuchKey');
    });

    supertest(self.app)
      .get('/s3-proxy/some-missing-path.txt')
      .expect(404)
      .end(done);
  });

  it('returns 304 for matching etag', function(done) {
    var etag = Date.now().toString();

    this.s3.get('/' + BUCKET_NAME + '/' + this.key, function(req, res, next) {
      if (req.headers['if-none-match'] === etag) {
        return sendS3Error(res, 412, 'PreconditionFailed');
      }

      res.status(500).end();
    });

    supertest(self.app)
      .get('/s3-proxy/' + this.key)
      .set('if-none-match', etag)
      .expect(304)
      .end(done);
  });

  it('returns 304 for S3 error NotModified', function(done) {
    this.s3.get('/' + BUCKET_NAME + '/' + this.key, function(req, res, next) {
      return sendS3Error(res, 304, 'NotModified');
    });

    supertest(self.app)
      .get('/s3-proxy/' + this.key)
      .expect(304)
      .end(done);
  });

  it('sets content-type header based on file path', function(done) {
    var key = urljoin('subfolder', 'data.csv');
    this.s3.get('/' + BUCKET_NAME + '/' + key, function(req, res, next) {
      res.set('content-type', 'application/octet-stream');
      res.end('some text');
    });

    supertest(self.app)
      .get('/s3-proxy/' + key)
      .expect(200)
      .expect('Content-Type', 'text/csv; charset=utf-8')
      .end(done);
  });

  it('streams an image', function(done) {
    var key = urljoin('images', 's3.png');
    this.s3.get('/' + BUCKET_NAME + '/' + key, function(req, res, next) {
      res.set('content-type', 'image/png');
      res.sendFile(path.join(__dirname, './fixtures/s3.png'));
    });

    supertest(self.app)
      .get('/s3-proxy/' + key)
      .expect(200)
      .expect('Content-Type', 'image/png')
      .end(done);
  });

  describe('cacheControl', function() {
    beforeEach(function() {
      self = this;

      this.s3CacheControl = null;
      this.etag = null;

      this.key = urljoin('images', 's3.png');
      this.s3.get('/' + BUCKET_NAME + '/' + this.key, function(req, res, next) {
        res.set('content-type', 'image/png');
        if (self.s3CacheControl) {
          res.set('cache-control', self.s3CacheControl);
        }
        if (self.etag) {
          res.set('etag', self.etag);
        }

        // pipe the stream rather than res.sendFile to avoid a
        // default cache-control header being sent.
        fs.createReadStream(path.join(__dirname, './fixtures/s3.png')).pipe(res);
      });
    });

    it('overrides cache-control', function(done) {
      this.s3CacheControl = 'nocache';
      this.pluginOptions.overrideCacheControl = 'max-age=10000';

      supertest(self.app)
        .get('/s3-proxy/' + this.key)
        .expect(200)
        .expect('cache-control', this.pluginOptions.overrideCacheControl)
        .end(done);
    });

    it('uses default cache control option if no cache-control from S3', function(done) {
      this.pluginOptions.defaultCacheControl = 'max-age=1000';

      supertest(self.app)
        .get('/s3-proxy/' + this.key)
        .expect(200)
        .expect('cache-control', this.pluginOptions.defaultCacheControl)
        .end(done);
    });

    it('uses S3 cache-control rather than defaultCacheControl option', function(done) {
      this.s3CacheControl = 'private, max-age=0';
      this.pluginOptions.defaultCacheControl = 'max-age=1000';

      supertest(self.app)
        .get('/s3-proxy/' + this.key)
        .expect(200)
        .expect('cache-control', this.s3CacheControl)
        .end(done);
    });
  });

  describe('lists keys', function() {
    beforeEach(function() {
      self = this;
      this.s3Keys = ['file1.txt', 'file2.xml', 'file3.json'];

      this.s3.get('/' + BUCKET_NAME, function(req, res, next) {
        var actualKeys;
        if (req.query.prefix) {
          actualKeys = [req.query.prefix].concat(_.map(self.s3Keys, function(key) {
            return urljoin(req.query.prefix, key);
          }));
        } else {
          actualKeys = self.s3Keys;
        }

        var contentsXml = _.map(actualKeys, function(key) {
          return '<Contents><Key>' + key + '</Key></Contents>';
        });

        var responseXml = '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>bucket</Name>' + contentsXml + '</ListBucketResult>';
        res.set('content-type', 'application/xml')
          .end(responseXml);
      });
    });

    it('without prefix', function(done) {
      supertest(self.app)
        .get('/s3-proxy/metadata/')
        .expect(200)
        .expect('content-type', 'application/json; charset=utf-8')
        .expect(function(res) {
          assert.deepEqual(res.body, self.s3Keys);
        })
        .end(done);
    });

    it('with prefix', function(done) {
      var prefix = 'folder-name';

      this.pluginOptions = _.extend({}, S3_OPTIONS, {
        prefix: prefix
      });

      supertest(self.app)
        .get('/s3-proxy/metadata/')
        .expect(200)
        .expect('content-type', 'application/json; charset=utf-8')
        .expect(function(res) {
          assert.deepEqual(res.body, self.s3Keys);
        })
        .end(done);
    });
  });

  it('strips out path segments starting with a double dash', function(done) {
    var key = urljoin('images', 'screenshot.png');
    this.s3.get('/' + BUCKET_NAME + '/' + key, function(req, res, next) {
      res.set('content-type', 'image/png');
      res.sendFile(path.join(__dirname, './fixtures/s3.png'));
    });

    supertest(self.app)
      .get(urljoin('/s3-proxy', '--5', key))
      .expect(200)
      .end(done);
  });
});

function sendS3Error(res, status, code) {
  res.status(status).set('content-type', 'application/xml')
    .end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>' + code + '</Code></Error>');
}
