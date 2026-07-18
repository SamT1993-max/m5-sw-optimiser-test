const API_KEY = document.querySelector('script[src*="maps.googleapis.com"]').src.split('key=')[1].split('&')[0];

const eastboundRamps =[
    { name: "M5 SW Hammondville Toll Entry", lat: -33.947360, lng: 150.965195 },
    { name: "Henry Lawson Dr", lat: -33.944423, lng: 150.981029 },
    { name: "River Rd", lat: -33.940468, lng: 151.017574 },
    { name: "Fairford Rd", lat: -33.939890, lng: 151.034139 },
    { name: "Belmore Rd", lat: -33.942283, lng: 151.053189 },
    { name: "King Georges Rd", lat: -33.943194, lng: 151.075194 }
];

const westboundRamps =[
    { name: "M5 SW Hammondville Toll Exit", lat: -33.947468, lng: 150.965190 },
    { name: "Henry Lawson Dr", lat: -33.945052, lng: 150.980974 },
    { name: "River Rd", lat: -33.940989, lng: 151.017142 },
    { name: "Fairford Rd", lat: -33.940462, lng: 151.034121 },
    { name: "Belmore Rd", lat: -33.942894, lng: 151.052814 },
    { name: "King Georges Rd", lat: -33.943598, lng: 151.076167 }
];

// The 5 Perfect Tripwires to catch ANY use of the M5 SW
const m5swCheckpoints = [
    { lat: -33.943671, lng: 151.065970 }, 
    { lat: -33.941543, lng: 151.044815 }, 
    { lat: -33.940500, lng: 151.026400 }, 
    { lat: -33.943494, lng: 150.998019 }, 
    { lat: -33.947065, lng: 150.969814 }  
];

let finalOrigin = "";
let finalDest = "";
let finalOriginPlaceId = ""; 
let finalDestPlaceId = "";   
let winningEntryNode = null;
let winningExitNode = null;
let liveGpsCoords = null; 
let isRouteEastbound = true; 
let useCurrentLocation = false;

let originPlaceId = "";
let destPlaceId = "";

function toggleExpandedOptimised() {
    document.getElementById('optContinueBtn').style.display = 'none';
    document.getElementById('optExplanationText').style.display = 'block';
    document.getElementById('optButtonGroup').style.display = 'flex';
}

window.onload = () => {
    const originEl = document.getElementById('originPicker');
    const destEl = document.getElementById('destPicker');
    const clearBtn = document.getElementById('clearOriginBtn');

    if (destEl) {
        destEl.addEventListener('gmp-placeselect', (event) => {
            destPlaceId = event.place.id || "";
        });
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                liveGpsCoords = { lat: position.coords.latitude, lng: position.coords.longitude };
                
                originEl.value = "Your location";
                originEl.classList.add("blue-gps-text");
                clearBtn.style.display = 'inline';

                clearBtn.addEventListener('click', () => {
                    originEl.value = "";
                    originPlaceId = ""; 
                    originEl.classList.remove("blue-gps-text");
                    if (originEl.shadowRoot) {
                        const innerInput = originEl.shadowRoot.querySelector('input');
                        if (innerInput) innerInput.value = "";
                    }
                    clearBtn.style.display = 'none';
                });

                originEl.addEventListener('gmp-placeselect', (event) => {
                    originEl.classList.remove("blue-gps-text");
                    clearBtn.style.display = 'none';
                    originPlaceId = event.place.id || ""; 
                });

                originEl.addEventListener('keydown', () => {
                    originEl.classList.remove("blue-gps-text");
                    clearBtn.style.display = 'none';
                    originPlaceId = ""; 
                });
                
                setTimeout(() => {
                    if (originEl.shadowRoot) {
                        const innerInput = originEl.shadowRoot.querySelector('input');
                        if (innerInput) {
                            innerInput.value = "Your location";
                        }
                    }
                }, 500);
            },
            (error) => { 
                console.log("GPS Location access denied."); 
                originEl.addEventListener('gmp-placeselect', (event) => {
                    originPlaceId = event.place.id || "";
                });
                originEl.addEventListener('keydown', () => {
                    originPlaceId = "";
                });
            }
        );
    } else {
        originEl.addEventListener('gmp-placeselect', (event) => {
            originPlaceId = event.place.id || "";
        });
        originEl.addEventListener('keydown', () => {
            originPlaceId = "";
        });
    }
};

function extractText(id) {
    const el = document.getElementById(id);
    if (!el) return "";
    if (el.value && el.value.trim().length > 0) return el.value.trim();
    if (el.inputValue && el.inputValue.trim().length > 0) return el.inputValue.trim();
    if (el.shadowRoot) { 
        const inner = el.shadowRoot.querySelector('input');
        if (inner && inner.value) return inner.value.trim();
    }
    return "";
}

function decodePolyline(encoded) {
    let points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return points;
}

function usesM5SouthWest(encodedPolyline) {
    if (!encodedPolyline) return false;
    const points = decodePolyline(encodedPolyline);
    for (let pt of points) {
        for (let cp of m5swCheckpoints) {
            if (Math.abs(pt.lat - cp.lat) < 0.0004 && Math.abs(pt.lng - cp.lng) < 0.0004) {
                return true;
            }
        }
    }
    return false;
}

async function fetchRoute(body, computeTolls = false) {
    let fieldMask = "routes.duration,routes.distanceMeters,routes.legs.startLocation,routes.legs.endLocation,routes.polyline.encodedPolyline";
    body.routingPreference = "TRAFFIC_AWARE";
    if (computeTolls) {
        body.extraComputations = ["TOLLS"];
        fieldMask += ",routes.travelAdvisory.tollInfo";
        if (!body.routeModifiers) body.routeModifiers = {};
        body.routeModifiers.tollPasses = ["AU_LINKT", "AU_ETOLL_TAG"];
    }
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": API_KEY, "X-Goog-FieldMask": fieldMask },
        body: JSON.stringify(body)
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        let startLng = null, endLng = null, routeToll = 0;
        let encodedPolyline = route.polyline ? route.polyline.encodedPolyline : "";
        
        if (route.legs && route.legs.length > 0) {
            const leg = route.legs[0];
            if (leg.startLocation && leg.startLocation.latLng) startLng = leg.startLocation.latLng.longitude;
            if (leg.endLocation && leg.endLocation.latLng) endLng = leg.endLocation.latLng.longitude;
        }
        if (route.travelAdvisory && route.travelAdvisory.tollInfo && route.travelAdvisory.tollInfo.estimatedPrice) {
            const price = route.travelAdvisory.tollInfo.estimatedPrice[0];
            routeToll = parseInt(price.units || "0") + (parseInt(price.nanos || "0") / 1e9);
        }
        return { durationSecs: parseInt(route.duration.replace('s', '')), distanceMeters: route.distanceMeters, startLng, endLng, toll: routeToll, encodedPolyline: encodedPolyline };
    }
    return null;
}

async function calculateRoutes() {
    const originText = extractText('originPicker');
    const destText = extractText('destPicker');
    const btn = document.getElementById('calcBtn');
    const showDev = document.getElementById('showDevResults') ? document.getElementById('showDevResults').checked : false;

    if(!originText || !destText) { alert("Please enter both locations!"); return; }

    useCurrentLocation = originText.toLowerCase() === "your location";
    let originPayload = useCurrentLocation ? { location: { latLng: { latitude: liveGpsCoords.lat, longitude: liveGpsCoords.lng } } } : { address: originText };
    
    finalOrigin = useCurrentLocation ? `${liveGpsCoords.lat},${liveGpsCoords.lng}` : originText;
    finalDest = destText;

    finalOriginPlaceId = useCurrentLocation ? "" : originPlaceId;
    finalDestPlaceId = destPlaceId;

    btn.innerText = "Running Matrix Algorithm...";
    btn.disabled = true;

    try {
        const defaultCall = fetchRoute({ origin: originPayload, destination: { address: destText }, travelMode: "DRIVE" }, true);
        const avoidCall = fetchRoute({ origin: originPayload, destination: { address: destText }, travelMode: "DRIVE", routeModifiers: { avoidTolls: true } }, false);
        const [defaultRes, avoidRes] = await Promise.all([defaultCall, avoidCall]);

        if (!defaultRes) { alert("Route failed. Please check spelling."); btn.innerText = "Calculate..."; btn.disabled = false; return; }

        isRouteEastbound = defaultRes.startLng <= defaultRes.endLng;
        const ramps = isRouteEastbound ? eastboundRamps : westboundRamps;
        const combinations = [];
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 6; j++) {
                if ((isRouteEastbound && i < j) || (!isRouteEastbound && i > j)) combinations.push({ entryIdx: i, exitIdx: j });
            }
        }

        const leg1Promises = ramps.map(r => fetchRoute({ origin: originPayload, destination: { location: { latLng: { latitude: r.lat, longitude: r.lng } } }, travelMode: "DRIVE", routeModifiers: { avoidTolls: true } }));
        const leg3Promises = ramps.map(r => fetchRoute({ origin: { location: { latLng: { latitude: r.lat, longitude: r.lng } } }, destination: { address: destText }, travelMode: "DRIVE", routeModifiers: { avoidTolls: true } }));
        const leg2Promises = combinations.map(c => fetchRoute({ origin: { location: { latLng: { latitude: ramps[c.entryIdx].lat, longitude: ramps[c.entryIdx].lng } } }, destination: { location: { latLng: { latitude: ramps[c.exitIdx].lat, longitude: ramps[c.exitIdx].lng } } }, travelMode: "DRIVE" }));

        const [l1R, l3R, l2R] = await Promise.all([Promise.all(leg1Promises), Promise.all(leg3Promises), Promise.all(leg2Promises)]);

        let bestTime = Infinity;
        let bestOptStats = null;
        let winningCombo = null;

        combinations.forEach((combo, idx) => {
            const l1 = l1R[combo.entryIdx], l2 = l2R[idx], l3 = l3R[combo.exitIdx];
            if (l1 && l2 && l3) {
                const totalTime = l1.durationSecs + l2.durationSecs + l3.durationSecs;
                if (totalTime <= bestTime) {
                    bestTime = totalTime;
                    winningCombo = combo;
                    bestOptStats = { durationSecs: totalTime, distanceMeters: l1.distanceMeters + l2.distanceMeters + l3.distanceMeters };
                }
            }
        });

        winningEntryNode = ramps[winningCombo.entryIdx];
        winningExitNode = ramps[winningCombo.exitIdx];
        
        btn.innerText = "Extracting Toll Price...";
        const finalTollCall = await fetchRoute({ origin: { location: { latLng: { latitude: winningEntryNode.lat, longitude: winningEntryNode.lng } } }, destination: { location: { latLng: { latitude: winningExitNode.lat, longitude: winningExitNode.lng } } }, travelMode: "DRIVE" }, true);
        bestOptStats.fullToll = finalTollCall ? finalTollCall.toll : 0;

        const defaultUsesM5SW = usesM5SouthWest(defaultRes.encodedPolyline);

        let optTrueFull = bestOptStats.fullToll;
        let defTrueFull = defaultRes.toll;
        
        let optOutOfPocket = optTrueFull;
        let defOutOfPocket = defTrueFull;

        if (optTrueFull > 0) {
            optOutOfPocket = optTrueFull / 11; 
        }

        if (defaultUsesM5SW && defTrueFull > 0) {
            if (defTrueFull >= optTrueFull) {
                let extraTunnels = defTrueFull - optTrueFull;
                defOutOfPocket = (optTrueFull / 11) + extraTunnels;
            } else {
                defOutOfPocket = defTrueFull / 11;
            }
        } else {
            defOutOfPocket = defTrueFull; 
        }

        let defCostHTML = defTrueFull > defOutOfPocket 
            ? `Tolls: <s style="font-weight:normal;">$${defTrueFull.toFixed(2)}</s> <b>$${defOutOfPocket.toFixed(2)}</b>`
            : `Tolls: <b>$${defTrueFull.toFixed(2)}</b>`;

        let optCostHTML = optTrueFull > optOutOfPocket
            ? `Tolls: <s style="font-weight:normal;">$${optTrueFull.toFixed(2)}</s> <b>$${optOutOfPocket.toFixed(2)}</b>`
            : `Tolls: <b>$${optTrueFull.toFixed(2)}</b>`;

        const cardDefault = document.getElementById('cardDefault');
        const defaultCostBox = document.getElementById('defaultCostBox');
        
        const cardOptimised = document.getElementById('cardOptimised');
        const optTitleText = document.getElementById('optTitleText');
        const optCostBox = document.getElementById('optCostBox');
        const optContinueBtn = document.getElementById('optContinueBtn');
        const optExplanationText = document.getElementById('optExplanationText');
        const optButtonGroup = document.getElementById('optButtonGroup');

        const cardAvoid = document.getElementById('cardAvoid');
        const avoidCostBox = document.getElementById('avoidCostBox');
        const avoidButtonGroup = document.getElementById('avoidButtonGroup');
        const avoidTitleText = document.getElementById('avoidTitleText'); 

        defaultCostBox.innerHTML = defCostHTML;

        const defaultMins = Math.round(defaultRes.durationSecs / 60);
        const optMins = Math.round(bestOptStats.durationSecs / 60);
        const avoidMins = Math.round(avoidRes.durationSecs / 60);

        const timeDiff = Math.abs(defaultMins - optMins);
        const distDiff = Math.abs((defaultRes.distanceMeters / 1000) - (bestOptStats.distanceMeters / 1000));

        if (defTrueFull === 0) {
            cardAvoid.classList.add('disabled-card');
            avoidTitleText.innerText = "Avoid tolls matches Default route"; 
            avoidCostBox.innerHTML = `<span style="font-size: 12px; color:#555;">Default route is already toll-free. Please use the Default route above.</span>`;
            avoidButtonGroup.style.display = 'none';
        } else {
            cardAvoid.classList.remove('disabled-card');
            avoidTitleText.innerText = "Avoid tolls route"; 
            avoidCostBox.innerHTML = `Tolls: $0.00`;
            avoidButtonGroup.style.display = 'flex';
        }

        if (timeDiff <= 1 && distDiff <= 1.0) {
            cardDefault.style.display = 'block';
            cardOptimised.classList.add('disabled-card');
            optTitleText.innerText = "M5 SW matches Default route"; 
            optCostBox.innerHTML = `<span style="font-size: 12px; color:#555;">This route is already the cheapest and fastest option. Please use the Default route above.</span>`;
            optContinueBtn.style.display = 'none';
            optButtonGroup.style.display = 'none';
            optExplanationText.style.display = 'none';
        } else if (optMins >= avoidMins) {
            cardDefault.style.display = 'block';
            cardOptimised.classList.add('disabled-card');
            optTitleText.innerText = "M5 SW not recommended";
            optCostBox.innerHTML = `<span style="font-size: 12px; color:#555;">This trip is short or toll-free. Please choose between Default and Avoid Tolls options.</span>`;
            optContinueBtn.style.display = 'none';
            optButtonGroup.style.display = 'none';
            optExplanationText.style.display = 'none';
        } else {
            cardDefault.style.display = 'block';
            cardOptimised.classList.remove('disabled-card');
            optTitleText.innerText = "M5 SW Optimised route"; 
            optCostBox.innerHTML = `${optCostHTML}<br><small>In: ${winningEntryNode.name} ➔ Out: ${winningExitNode.name}</small>`;
            document.getElementById('dynamicExplainer').innerHTML = `
                Google Maps Limitation: We cannot mix toll and no-toll roads in a single Google Maps trip.<br><br>
                To fix this, we will launch a completely toll-free route, but we've added your required ${winningEntryNode.name} entry and ${winningExitNode.name} exit ramps as "Stops."<br><br>
                Maps will guide you to the entry ramp. Once on the M5, just keep driving until your designated exit ramp stops. Maps will then automatically guide you the rest of the way!
            `;
            optContinueBtn.style.display = 'block';
            optButtonGroup.style.display = 'none';
            optExplanationText.style.display = 'none';
        }

        updateCard("defaultStats", defaultRes);
        updateCard("avoidStats", avoidRes);
        updateCard("optStats", bestOptStats);
        document.getElementById('results').style.display = 'block';
        btn.innerText = "Calculate...";
        btn.disabled = false;

        const devBox = document.getElementById('devResultsBox');
        if (showDev) {
            const devList = document.getElementById('devResultsList');
            devList.innerHTML = "";
            combinations.forEach((c, i) => {
                const l1 = l1R[c.entryIdx], l2 = l2R[i], l3 = l3R[c.exitIdx];
                if (l1 && l2 && l3) {
                    const li = document.createElement('li');
                    li.innerText = `In: ${ramps[c.entryIdx].name} Out: ${ramps[c.exitIdx].name} | ${Math.round((l1.durationSecs + l2.durationSecs + l3.durationSecs)/60)} min`;
                    if (c === winningCombo) li.style.fontWeight = "bold";
                    devList.appendChild(li);
                }
            });
            devBox.style.display = "block";
        } else { devBox.style.display = "none"; }

    } catch (e) { console.error(e); btn.innerText = "Calculate..."; btn.disabled = false; }
}

function updateCard(id, data) {
    const mins = Math.round(data.durationSecs / 60);
    const km = (data.distanceMeters / 1000).toFixed(1);
    const now = new Date();
    const etaDate = new Date(now.getTime() + data.durationSecs * 1000);
    const etaString = etaDate.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });

    document.getElementById(id).innerHTML = `Time: ${mins} min | ETA: ${etaString}<br>Distance: ${km} km`;
}

// STREAMLINED: Securely maps the unique Place IDs to ALL THREE route options to avoid any regional look-up ambiguities! [1.2.1, 1.2.2]
function launchGoogleMaps(type) {
    let url = `https://www.google.com/maps/dir/?api=1`;
    
    // 1. Origin (Applies to all) [1.2.1]
    if (!useCurrentLocation) {
        url += `&origin=${encodeURIComponent(finalOrigin)}`;
        if (finalOriginPlaceId) {
            url += `&origin_place_id=${finalOriginPlaceId}`;
        }
    }

    // 2. Destination (Applies to all) [1.2.1]
    url += `&destination=${encodeURIComponent(finalDest)}`;
    if (finalDestPlaceId) {
        url += `&destination_place_id=${finalDestPlaceId}`;
    }

    // 3. Route-Specific Parameters [1.2.1, 1.2.2]
    if (type === 'default') {
        url += `&travelmode=driving`;
    } else if (type === 'avoid') {
        url += `&avoid=tolls&travelmode=driving`;
    } else if (type === 'optimised' && winningEntryNode && winningExitNode) {
        const waypoints = encodeURIComponent(`${winningEntryNode.lat},${winningEntryNode.lng}|${winningExitNode.lat},${winningExitNode.lng}`);
        url += `&waypoints=${waypoints}&avoid=tolls&travelmode=driving`;
    }
    
    window.open(url, "_blank");
}
