/* eslint no-console: 0 */

var _ = require('lodash');
var http = require('http');
var assert = require('assert');
var urljoin = require('url-join');
var express = require('express');
var supertest = require('supertest');
var debug = require('debug')('4front:plugins:s3-bridge:test');

require('simple-errors');
require('dash-assert');

var BUCKET_NAME = 's3-bridge-bucket';

var S3_PORT = 4658;
var S3_OPTIONS = {
  bucket: BUCKET_NAME,
  region: 'us-west-2',
  accessKeyId: '123',
  secretAccessKey: 'abc',
  endpoint: 'localhost:' + S3_PORT,
  sslEnabled: false,
  s3ForcePathStyle: true
};

describe('S3Storage', function() {
  var self;

  beforeEach(function(done) {
    self = this;

    this.app = express();
    this.s3 = express();

    this.s3.use(function(req, res, next) {
      debug('request to fake S3 server', req.path, req.method);
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
      res.status(404).set('content-type', 'application/xml')
        .end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>');
    });

    supertest(self.app)
      .get('/s3-proxy/some-missing-path.txt')
      .expect(404)
      .end(done);
  });
});
