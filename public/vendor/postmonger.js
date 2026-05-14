/*!
 * Minimal Postmonger-compatible client for Salesforce Marketing Cloud Journey Builder custom activities.
 * It implements the Session API used by this project: on(event, handler) and trigger(event, data).
 */
(function (window) {
  'use strict';

  function parseMessage(message) {
    if (!message) return null;

    if (typeof message === 'string') {
      try {
        return JSON.parse(message);
      } catch (_error) {
        return null;
      }
    }

    if (typeof message === 'object') {
      return message;
    }

    return null;
  }

  function Session() {
    this.handlers = {};
    this.target = window.parent || window.opener;

    var self = this;

    window.addEventListener('message', function (event) {
      var message = parseMessage(event.data);
      if (!message) return;

      var eventName = message.event || message.type || message.name;
      if (!eventName) return;

      var data = Object.prototype.hasOwnProperty.call(message, 'data')
        ? message.data
        : message.payload;

      var handlers = self.handlers[eventName] || [];
      handlers.forEach(function (handler) {
        try {
          handler(data, event);
        } catch (error) {
          setTimeout(function () {
            throw error;
          }, 0);
        }
      });
    });
  }

  Session.prototype.on = function (eventName, handler) {
    if (!this.handlers[eventName]) {
      this.handlers[eventName] = [];
    }

    this.handlers[eventName].push(handler);
    return this;
  };

  Session.prototype.off = function (eventName, handler) {
    if (!this.handlers[eventName]) return this;

    if (!handler) {
      delete this.handlers[eventName];
      return this;
    }

    this.handlers[eventName] = this.handlers[eventName].filter(function (registeredHandler) {
      return registeredHandler !== handler;
    });

    return this;
  };

  Session.prototype.trigger = function (eventName, data) {
    if (!this.target || typeof this.target.postMessage !== 'function') {
      return this;
    }

    var message = {
      event: eventName,
      data: data
    };

    // Postmonger historically sends serialized JSON. Journey Builder accepts this format.
    this.target.postMessage(JSON.stringify(message), '*');
    return this;
  };

  window.Postmonger = window.Postmonger || {};
  window.Postmonger.Session = window.Postmonger.Session || Session;
})(window);
