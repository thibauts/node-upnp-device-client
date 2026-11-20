var assert = require('assert');
var http = require('http');
var DeviceClient = require('../');

var tests = [];

function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

function request(options, body, callback) {
  var req = http.request(options, function(res) {
    res.resume();
    res.on('end', function() {
      callback(null, res);
    });
  });
  req.on('error', callback);
  req.setTimeout(2000, function() {
    req.destroy(new Error('request timed out'));
  });
  req.end(body);
}

test('ignores malformed LastChange events and acknowledges the notification', function(done) {
  var client = new DeviceClient('http://127.0.0.1/device.xml');
  var serviceId = 'urn:upnp-org:serviceId:AVTransport';
  var received = [];

  client.subscriptions[serviceId] = {
    sid: 'uuid:test-subscription',
    listeners: [function(event) {
      received.push(event);
    }]
  };

  client.ensureEventingServer(function() {
    var address = client.server.address();
    var options = {
      host: address.address,
      port: address.port,
      method: 'NOTIFY',
      path: '/',
      headers: {
        SID: 'uuid:test-subscription',
        SEQ: '1'
      }
    };
    var malformed = [
      '<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">',
      '<e:property><LastChange>',
      '&lt;Event&gt;&lt;InstanceID val="0"&gt;',
      '&lt;CurrentTrackURI val="http://example.test/video?file=0&amp;audioTrack=1"/&gt;',
      '&lt;/InstanceID&gt;&lt;/Event&gt;',
      '</LastChange></e:property></e:propertyset>'
    ].join('');

    request(options, malformed, function(err, res) {
      if(err) return finish(err);

      try {
        assert.strictEqual(res.statusCode, 200);
        assert.deepStrictEqual(received, []);
      } catch(assertErr) {
        return finish(assertErr);
      }

      options.headers.SEQ = '2';
      var valid = [
        '<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">',
        '<e:property><LastChange>',
        '&lt;Event&gt;&lt;InstanceID val="0"&gt;',
        '&lt;TransportState val="PLAYING"/&gt;',
        '&lt;/InstanceID&gt;&lt;/Event&gt;',
        '</LastChange></e:property></e:propertyset>'
      ].join('');

      request(options, valid, function(validErr, validRes) {
        if(validErr) return finish(validErr);
        try {
          assert.strictEqual(validRes.statusCode, 200);
          assert.strictEqual(received.length, 1);
          assert.strictEqual(received[0].InstanceID, 0);
          assert.strictEqual(received[0].TransportState, 'PLAYING');
          finish();
        } catch(assertErr) {
          finish(assertErr);
        }
      });
    });
  });

  function finish(err) {
    client.server.close(function() {
      done(err);
    });
  }
});

test('returns malformed SOAP responses through the callback', function(done) {
  var deviceServer = http.createServer(function(req, res) {
    res.setHeader('Content-Type', 'text/xml');

    if(req.url === '/device.xml') {
      return res.end([
        '<root><device>',
        '<deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>',
        '<friendlyName>Test renderer</friendlyName>',
        '<UDN>uuid:test</UDN>',
        '<serviceList><service>',
        '<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>',
        '<serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>',
        '<SCPDURL>/service.xml</SCPDURL>',
        '<controlURL>/control</controlURL>',
        '<eventSubURL>/events</eventSubURL>',
        '</service></serviceList>',
        '</device></root>'
      ].join(''));
    }

    if(req.url === '/service.xml') {
      return res.end([
        '<scpd><actionList><action>',
        '<name>GetPositionInfo</name>',
        '<argumentList><argument>',
        '<name>TrackURI</name><direction>out</direction>',
        '<relatedStateVariable>CurrentTrackURI</relatedStateVariable>',
        '</argument></argumentList>',
        '</action></actionList><serviceStateTable></serviceStateTable></scpd>'
      ].join(''));
    }

    res.end('<Envelope><TrackURI>http://example.test/video?file=0&audioTrack=1</TrackURI></Envelope>');
  });

  deviceServer.listen(0, '127.0.0.1', function() {
    var address = deviceServer.address();
    var client = new DeviceClient('http://127.0.0.1:' + address.port + '/device.xml');

    client.callAction('AVTransport', 'GetPositionInfo', {}, function(err) {
      deviceServer.close(function() {
        try {
          assert(err);
          assert.strictEqual(err.code, 'EUPNP');
          assert.strictEqual(err.statusCode, 200);
          done();
        } catch(assertErr) {
          done(assertErr);
        }
      });
    });
  });
});

function run(index) {
  if(index === tests.length) return;
  var current = tests[index];
  current.fn(function(err) {
    if(err) {
      console.error('not ok - ' + current.name);
      console.error(err.stack || err);
      process.exitCode = 1;
      return;
    }
    console.log('ok - ' + current.name);
    run(index + 1);
  });
}

run(0);
