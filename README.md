# s3-proxy

[![Build Status][travis-image]][travis-url]
[![Test Coverage][coveralls-image]][coveralls-url]

S3 proxy middleware for returning S3 objects Express apps. Useful for streaming media files and data files from S3 without having to configure web hosting on the entire origin bucket. You can explicitly override the cache headers of the underlying S3 objects.

## Usage

~~~js
import express from 'express';
import s3Proxy from 's3-proxy';

const app = express();
app.get('/media/*', s3Proxy({
  bucket: 'bucket_name',
  prefix: 'optional_s3_path_prefix',
  accessKeyId: 'aws_access_key_id',
  secretAccessKey: 'aws_secret_access_key',
  overrideCacheControl: 'max-age=100000',
  defaultKey: 'index.html'
}));
~~~

### Options

__`accessKeyId`__

The AWS access key of the IAM user to connect to S3 with  (environment variable recommended).

__`secretAccessKey`__

The AWS secret access key (environment variable recommended).

__`region`__

The AWS region of the bucket, i.e. "us-west-2".

__`bucket`__

The name of the S3 bucket.

__`prefix`__

Optional path to the root S3 folder where the files to be hosted live. If omitted, the http requests to the proxy need to mirror the full S3 path.

__`defaultCacheControl`__

Value of the `Cache-Control` header to use if the metadata from the S3 object does not specify it's own value.

__`overrideCacheControl`__

Value of the `Cache-Control` header that is applied to the response even if there there is a different value on the S3 object metadata.

__`defaultKey`__

If a call is made to a url ending in `/`, and this option is present its value is used as the s3 key name. For example, you may wish to allow users to access `/index.html` when calling `/` on a route. 


### HTTP Cache Headers

The `s3-proxy` provides two different caching mechanisms. First you can specify either the `defaultCacheControl` or `overrideCacheControl` options to control the `Cache-Control` header that is sent in the proxied response. The most optimal policy is to specify a `max-age=seconds` value that informs the browser and any intermediary CDN and network proxies to cache the response for the specified number of seconds and not return to the origin server until that time has elapsed.

Secondly it supports the `ETag` value that S3 automatically creates whenever an object is written. The proxy forwards this header along in the http response. If the value of an incoming `If-None-Match` request header matches the `ETag` of the S3 object, the proxy returns an empty `304 Not Modified` response. This is known as a "conditional get" request.

For a more in-depth description of the different caching headers and techniques, see the [Google Developer HTTP caching documentation](https://developers.google.com/web/fundamentals/performance/optimizing-content-efficiency/http-caching?hl=en).

## Example

Let's assume there is a bucket "mycompany-media-assets". Within this bucket is a folder named "website" where the images, videos, etc. for the company website reside.

~~~sh
mycompany-media-assets
└── website
    └── images
        ├── logo.png
        └── background.jpg
~~~

The corresponding s3-proxy route definition would look something like below. The `Cache-Control` response header will be set to have a max age of 30 days (2592000 seconds) no matter what metadata exists on the corresponding S3 object. This means whatever tool is being used to write the files to S3 need not worry about configuring proper cache metadata, the proxy will take care of that.

~~~js
app.get('/media/*', s3Proxy({
  bucket: 'mycompany-media-assets',
  prefix: 'website',
  accessKeyId: 'aws_access_key_id',
  secretAccessKey: 'aws_secret_access_key',
  overrideCacheControl: 'max-age=2592000'
}));
~~~

Now images can be declared in views like so:

~~~html
<img src="/media/images/logo.png"/>
~~~

### Listing objects
It's also possible to return a JSON listing of all the keys by making a request ending with a trailing slash. For the sample above, issuing a request to `/media/images/` will return: `['logo.png', 'background.jpg']`. This is the default behavior when `defaultKey` is false.

### Default Key 
If you don't need list objects when making requests ending in a trailing slash, you can instead use a default s3 key by setting the parameter `defaultKey` in options. For example, if `defaultKey` is set to `index.html`, calls to urls like `/media` will return to object `/media/index.html`. 

## License
Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).

[travis-image]: https://img.shields.io/travis/4front/s3-proxy.svg?style=flat
[travis-url]: https://travis-ci.org/4front/s3-proxy
[coveralls-image]: https://img.shields.io/coveralls/4front/s3-proxy.svg?style=flat
[coveralls-url]: https://coveralls.io/r/4front/s3-proxy?branch=master
