/*
 * Postmonger-compatible lightweight client for Journey Builder Custom Activities.
 * It intentionally exposes the same API used by SFMC examples:
 *   const connection = new Postmonger.Session();
 *   connection.on('initActivity', handler);
 *   connection.trigger('ready');
 *
 * In production, you can replace this file with the official Postmonger build if
 * your organization standardizes on a vendored copy. This implementation keeps
 * the required API local so no secrets or external CDN scripts are needed.
 */
(function (window) {
  'use strict';

  function parseMessage(event) {
    var data = event.data;

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (_err) {
        return null;
      }
    }

    if (!data || typeof data !== 'object') return null;

    // Supported inbound shapes used across Postmonger/JB wrappers.
    var name = data.event || data.key || data.name || data.type || data.method;
    var payload = Object.prototype.hasOwnProperty.call(data, 'data')
      ? data.data
      : Object.prototype.hasOwnProperty.call(data, 'payload')
        ? data.payload
        : data.value;

    if (Array.isArray(data.args) && data.args.length) {
      name = data.args[0] || name;
      payload = data.args.length > 2 ? data.args.slice(1) : data.args[1];
    }

    if (!name) return null;

    return { name: name, payload: payload, raw: data };
  }

  function Session() {
    this._handlers = {};
    this._target = window.parent || window.opener || window.top;
    this._targetOrigin = '*';

    var self = this;
    this._listener = function (event) {
      var message = parseMessage(event);
      if (!message) return;

      var handlers = self._handlers[message.name] || [];
      handlers.forEach(function (handler) {
        handler(message.payload, message.raw);
      });
    };

    window.addEventListener('message', this._listener, false);
  }

  Session.prototype.on = function (eventName, callback) {
    if (!this._handlers[eventName]) this._handlers[eventName] = [];
    this._handlers[eventName].push(callback);
    return this;
  };

  Session.prototype.off = function (eventName, callback) {
    if (!this._handlers[eventName]) return this;

    if (!callback) {
      delete this._handlers[eventName];
      return this;
    }

    this._handlers[eventName] = this._handlers[eventName].filter(function (handler) {
      return handler !== callback;
    });

    return this;
  };

  Session.prototype.trigger = function (eventName, payload) {
    if (!this._target || !this._target.postMessage) return this;

    /*
     * Journey Builder expects the same envelope used by the official Postmonger
     * library: { method: 'trigger', args: [eventName, payload] }.
     *
     * The event/key/data fields are kept for backwards compatibility with
     * lightweight local harnesses, but the important part for SFMC is
     * method='trigger' + args.
     */
    var args = Array.prototype.slice.call(arguments);
    var message = {
      method: 'trigger',
      args: args,
      event: eventName,
      key: eventName,
      data: payload,
      payload: payload
    };

    this._target.postMessage(JSON.stringify(message), this._targetOrigin);
    return this;
  };

  Session.prototype.destroy = function () {
    window.removeEventListener('message', this._listener, false);
    this._handlers = {};
  };

  window.Postmonger = window.Postmonger || {};
  window.Postmonger.Session = Session;
})(window);