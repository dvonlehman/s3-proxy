/* eslint no-console: 0 */

var _ = require('lodash');
var http = require('http');
var path = require('path');
var assert = require('assert');
var urljoin = require('url-join');
var express = require('express');
var supertest = require('supertest');
var debug = require('debug')('4front:plugins:s3-proxy:test');

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
    this.pluginOptions = S3_OPTIONS;

    this.s3.use(function(req, res, next) {
      debug('request to fake S3 server', req.path, req.method);
      next();
    });

    this.s3.get('/test', function(req, res, next) {
      res.send('OK');
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

  it('transforms csv to json output', function(done) {
    var csvFile = 'first,last,age\n' +
      'Frank,Smith,40\n' +
      'Sally,Thomas,27\n' +
      'Bruno,Schmidt,47';

    this.pluginOptions = _.extend({}, S3_OPTIONS, {
      csvToJson: true
    });

    var key = 'people.csv';
    this.s3.get('/' + BUCKET_NAME + '/' + key, function(req, res, next) {
      res.set('Content-Type', 'text/csv');
      res.end(csvFile);
    });

    supertest(self.app)
      .get(urljoin('/s3-proxy', key))
      .expect(200)
      .expect('content-type', 'application/json; charset=utf-8')
      .expect(function(res) {
        assert.equal(3, res.body.length);
        assert.deepEqual(res.body[0], {first: 'Frank', last: 'Smith', age: 40});
      })
      .end(done);
  });
});
