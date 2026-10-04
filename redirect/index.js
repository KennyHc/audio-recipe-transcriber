const TARGET = "https://recipe-transcriber.pages.dev";

export default {
  fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(TARGET + url.pathname + url.search + url.hash, 301);
  },
};
