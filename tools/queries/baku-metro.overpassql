// Every Baku Metro route relation (both directions, all branches) with its member stops.
// The bounding box covers the whole city of Baku (south, west, north, east).
[out:json][timeout:90];
relation["route"="subway"](40.30,49.70,40.50,50.10);
out body;
>;
out body qt;
