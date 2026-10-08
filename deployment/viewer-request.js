// CloudFront Function: redirect aliases before the browser opens IndexedDB.
// The template generator replaces this marker with the configured canonical hostname.
function handler(event) {
  var request = event.request;
  var canonicalHost = "__CANONICAL_HOST__";
  if (request.method !== "GET" && request.method !== "HEAD") {
    return {
      statusCode: 405,
      statusDescription: "Method Not Allowed",
      headers: { allow: { value: "GET, HEAD" } },
    };
  }
  if (canonicalHost && request.headers.host.value !== canonicalHost) {
    var pairs = [];
    var query = request.querystring || {};
    Object.keys(query).forEach(function (key) {
      var values = query[key].multiValue || [query[key]];
      values.forEach(function (item) {
        pairs.push(key + "=" + item.value);
      });
    });
    return {
      statusCode: 308,
      statusDescription: "Permanent Redirect",
      headers: {
        location: {
          value:
            "https://" +
            canonicalHost +
            request.uri +
            (pairs.length ? "?" + pairs.join("&") : ""),
        },
        "cache-control": { value: "public, max-age=300" },
      },
    };
  }
  if (request.uri.endsWith("/")) request.uri += "index.html";
  // LICENSE, NOTICE and COPYING are real static objects, often without extensions.
  else if (
    request.uri.indexOf("/licenses/") !== 0 &&
    request.uri.split("/").pop().indexOf(".") === -1
  )
    request.uri += "/index.html";
  return request;
}
