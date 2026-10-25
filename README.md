# Natural selection: blending in

Standalone GitHub Pages build of the natural-selection applet from [physics_demos](https://github.com/MartinAlvarezSergio/physics_demos).

Live: https://martinalvarezsergio.github.io/natural_selection_playground/

Googly-eyed blobs split in two after eating a strawberry, and the new copy's trait can mutate a
little at random. Purple predators hunt by sight. Pick the trait that varies:

- **Colour**: blobs that stand out from the ground under them are spotted and eaten, so over the
  generations the population's colours follow the ground (photos of Oklahoma, New York, South
  Carolina, Minnesota and Spain, or any plain colour).
- **Hiding**: every blob is the same colour, but when a predator closes in it can turn invisible
  (shown with a shield) for its inherited hiding time. The predator waits, puzzled, and catches it
  only if it reappears too soon.

Switch between Darwin (traits fixed for life) and Lamarck (changes during life are passed on), or
run **Darwin vs Lamarck** side by side from the same starting blobs. An asteroid button shows a
mass extinction and recovery.

```bash
npm install
npm run dev
npm run deploy   # build + publish gh-pages
```

The applet code is synchronized from `physics_demos/src/applets/natural_selection`.
Publish source changes on `main`, then run `npm run deploy` to update GitHub Pages.

Photo credits: `public/natural_selection/CREDITS.txt`.
