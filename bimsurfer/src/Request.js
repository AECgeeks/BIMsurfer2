
export function Make(args) {
  return new Promise(function(resolve, reject) {
    const xhr = new XMLHttpRequest();
    xhr.open(args.method || 'GET', args.url, true);
    xhr.onload = function(e) {
      console.log(args.url, xhr.readyState, xhr.status);
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          if (xhr.getResponseHeader('content-type') == 'application/json') {
            resolve(JSON.parse(xhr.responseText));
          } else {
            resolve(xhr.responseXML);
          }
        } else {
          reject(xhr.statusText);
        }
      }
    };
    xhr.send(null);
  });
}
