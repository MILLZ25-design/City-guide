const API_BASE = 'https://app-citi-guide-backend.onrender.com';
const ACCESS_KEY = 'cityguide_access_token';
const REFRESH_KEY = 'cityguide_refresh_token';
const USER_KEY = 'cityguide_admin_user';
const PAGE_SIZE = 20;
const $ = id => document.getElementById(id);

const state = {
  accessToken: localStorage.getItem(ACCESS_KEY),
  refreshToken: localStorage.getItem(REFRESH_KEY),
  user: readStoredUser(),
  cities: [],
  places: [],
  placePage: 0,
  totalPlaces: 0,
  totalPages: 0,
  reviews: [],
  editingCityId: null,
  editingPlaceId: null,
  searchTimer: null
};

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function storeSession(session) {
  state.accessToken = session.accessToken;
  state.refreshToken = session.refreshToken;
  state.user = session.user;
  localStorage.setItem(ACCESS_KEY, session.accessToken);
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

function clearSession() {
  state.accessToken = null;
  state.refreshToken = null;
  state.user = null;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

function showLogin(message = '') {
  $('appShell').hidden = true;
  $('authScreen').hidden = false;
  $('loginError').textContent = message;
  $('loginError').hidden = !message;
}

function showDashboard() {
  $('authScreen').hidden = true;
  $('appShell').hidden = false;
  const user = state.user || {};
  const name = user.name || 'Admin';
  $('userNameSide').textContent = name;
  $('userEmailSide').textContent = user.email || '';
  $('avSide').textContent = initials(name);
  $('avTop').textContent = initials(name);
}

function initials(name) {
  return String(name || 'Admin').trim().split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase();
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function refreshSession() {
  if (!state.refreshToken) return false;
  const response = await fetch(API_BASE + '/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: state.refreshToken })
  });
  const data = await readResponse(response);
  if (!response.ok) return false;
  if (!data || !data.accessToken) throw new Error('The refresh response did not include an access token.');

  state.accessToken = data.accessToken;
  state.refreshToken = data.refreshToken || state.refreshToken;
  localStorage.setItem(ACCESS_KEY, state.accessToken);
  localStorage.setItem(REFRESH_KEY, state.refreshToken);
  return true;
}

async function api(path, options = {}, retry = true) {
  const headers = { ...(options.headers || {}) };
  if (state.accessToken) headers.Authorization = 'Bearer ' + state.accessToken;
  const hasContentType = Object.keys(headers).some(name => name.toLowerCase() === 'content-type');
  if (options.body && !(options.body instanceof FormData) && !hasContentType) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(API_BASE + path, { ...options, headers });
  if (response.status === 401 && retry && await refreshSession()) return api(path, options, false);
  if (response.status === 401) {
    clearSession();
    showLogin('Your session expired. Please sign in again.');
    throw new Error('Your session expired. Please sign in again.');
  }

  const data = await readResponse(response);
  if (!response.ok) throw new Error(data && data.message || 'Request failed (' + response.status + ').');
  return data;
}

function notify(message, isError = false) {
  const notice = $('notice');
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => { notice.hidden = true; }, 4500);
}

function setSection(sectionId) {
  const section = $(sectionId);
  if (!section) return;
  document.querySelectorAll('main > section').forEach(item => { item.hidden = item.id !== sectionId; });
  document.querySelectorAll('.nav[data-section]').forEach(button => {
    button.classList.toggle('on', button.dataset.section === sectionId);
  });
  $('pageTitle').textContent = sectionId === 'dashboard' ? 'Dashboard' : sectionId[0].toUpperCase() + sectionId.slice(1);
  document.body.classList.remove('open');
  window.scrollTo(0, 0);
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  $('loginError').hidden = true;
  setBusy(button, true, 'Signing in...');
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value })
    });
    if (!result || !result.user || result.user.role !== 'ADMIN') {
      clearSession();
      throw new Error('This account does not have administrator access.');
    }
    if (!result.accessToken || !result.refreshToken) {
      throw new Error('The login response did not include the required tokens.');
    }
    storeSession(result);
    showDashboard();
    await loadInitialData();
    form.reset();
  } catch (error) {
    $('loginError').textContent = error.message;
    $('loginError').hidden = false;
  } finally {
    setBusy(button, false);
  }
}

async function loadInitialData() {
  try {
    await Promise.all([loadCities(), loadPlaces(0)]);
    populateCityOptions();
    updateDashboard();
    setSection('dashboard');
  } catch (error) {
    notify(error.message, true);
  }
}

async function loadCities() {
  const result = await api('/api/cities');
  if (!Array.isArray(result)) throw new Error('The cities endpoint returned an unexpected response.');
  state.cities = result;
  renderCities();
  populateCityOptions();
  updateDashboard();
}

function buildPlaceQuery(page) {
  const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE), sort: $('filterSort').value || 'rating' });
  [['q', $('placeSearch').value.trim()], ['city', $('filterCity').value],
    ['category', $('filterCategory').value], ['minRating', $('filterRating').value]]
    .forEach(([key, value]) => { if (value) params.set(key, value); });
  return params;
}

async function loadPlaces(page = state.placePage) {
  $('placeRows').innerHTML = '<tr><td colspan="5" class="muted">Loading places...</td></tr>';
  const result = await api('/api/places?' + buildPlaceQuery(page).toString());
  if (!result || !Array.isArray(result.items)) throw new Error('The places endpoint returned an unexpected response.');
  state.places = result.items;
  state.placePage = Number(result.page || 0);
  state.totalPlaces = Number(result.totalItems || 0);
  state.totalPages = Number(result.totalPages || 0);
  renderPlaces();
  populateCityOptions();
  updateDashboard();
}

function updateDashboard() {
  $('cityCount').textContent = state.cities.length.toLocaleString();
  $('placeCount').textContent = state.totalPlaces.toLocaleString();
}

function cityName(cityId) {
  const city = state.cities.find(item => item.id === cityId);
  return city ? city.name : cityId || 'Unknown city';
}

function renderPlaces() {
  const rows = $('placeRows');
  if (!state.places.length) {
    rows.innerHTML = '<tr><td colspan="5" class="muted">No places found.</td></tr>';
  } else {
    rows.innerHTML = state.places.map(place => {
      const id = escapeHtml(place.id);
      const rating = Number(place.avgRating || place.baseRating || 0).toFixed(1);
      return '<tr><td><b>' + escapeHtml(place.name) + '</b></td>' +
        '<td>' + escapeHtml(cityName(place.cityId)) + '</td>' +
        '<td><span class="tag">' + escapeHtml(place.category) + '</span></td><td>' + rating + '</td>' +
        '<td class="actions"><button class="btn" type="button" data-action="edit-place" data-id="' + id + '">Edit</button> ' +
        '<button class="btn" type="button" data-action="place-reviews" data-id="' + id + '">Reviews</button> ' +
        '<button class="x" type="button" data-action="delete-place" data-id="' + id + '">Remove</button></td></tr>';
    }).join('');
  }
  $('pageInfo').textContent = state.totalPlaces
    ? 'Page ' + (state.placePage + 1) + ' of ' + Math.max(1, state.totalPages) + ' (' + state.totalPlaces + ' places)'
    : 'No places';
  $('prevPage').disabled = state.placePage <= 0;
  $('nextPage').disabled = state.totalPages === 0 || state.placePage + 1 >= state.totalPages;
}

function renderCities() {
  const rows = $('cityRows');
  if (!state.cities.length) {
    rows.innerHTML = '<tr><td colspan="4" class="muted">No cities found.</td></tr>';
    return;
  }
  rows.innerHTML = state.cities.map(city => {
    const id = escapeHtml(city.id);
    const coordinates = Number(city.lat).toFixed(3) + ', ' + Number(city.lng).toFixed(3);
    return '<tr><td><b>' + escapeHtml(city.name) + '</b></td><td>' + escapeHtml(city.country || '') + '</td>' +
      '<td>' + escapeHtml(coordinates) + '</td><td class="actions">' +
      '<button class="btn" type="button" data-action="edit-city" data-id="' + id + '">Edit</button> ' +
      '<button class="x" type="button" data-action="delete-city" data-id="' + id + '">Remove</button></td></tr>';
  }).join('');
}

function populateCityOptions() {
  const filterCity = $('filterCity');
  const placeCity = $('placeCity');
  const reviewPlace = $('reviewPlace');
  const selectedCity = filterCity.value;
  const selectedFormCity = placeCity.value;
  const selectedReviewPlace = reviewPlace.value;
  const options = state.cities.map(city => '<option value="' + escapeHtml(city.id) + '">' + escapeHtml(city.name) + '</option>').join('');
  filterCity.innerHTML = '<option value="">All cities</option>' + options;
  placeCity.innerHTML = '<option value="">Choose a city</option>' + options;
  reviewPlace.innerHTML = '<option value="">Choose a place</option>' + state.places.map(place =>
    '<option value="' + escapeHtml(place.id) + '">' + escapeHtml(place.name) + ' - ' + escapeHtml(cityName(place.cityId)) + '</option>'
  ).join('');
  if (state.cities.some(city => city.id === selectedCity)) filterCity.value = selectedCity;
  if (state.cities.some(city => city.id === selectedFormCity)) placeCity.value = selectedFormCity;
  if (state.places.some(place => place.id === selectedReviewPlace)) reviewPlace.value = selectedReviewPlace;
}

function openCityDialog(city = null) {
  state.editingCityId = city ? city.id : null;
  $('cityForm').reset();
  $('cityDialogTitle').textContent = city ? 'Edit city' : 'Add city';
  $('cityId').disabled = Boolean(city);
  $('cityId').value = city ? city.id : '';
  $('cityName').value = city ? city.name || '' : '';
  $('cityCountry').value = city ? city.country || '' : '';
  $('cityLat').value = city && city.lat != null ? city.lat : '';
  $('cityLng').value = city && city.lng != null ? city.lng : '';
  $('cityTimezone').value = city ? city.timezone || '' : '';
  $('cityHue').value = city && city.hue != null ? city.hue : '';
  $('cityBlurb').value = city ? city.blurb || '' : '';
  $('cityDescription').value = city ? city.description || '' : '';
  $('cityDialog').showModal();
}

async function saveCity(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const name = $('cityName').value.trim();
  const id = state.editingCityId || slugify($('cityId').value.trim() || name);
  const lat = Number($('cityLat').value);
  const lng = Number($('cityLng').value);
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    notify('Enter a valid city ID and coordinates.', true);
    return;
  }

  const payload = {
    id,
    name,
    country: $('cityCountry').value.trim(),
    lat,
    lng,
    timezone: $('cityTimezone').value.trim() || null,
    hue: $('cityHue').value === '' ? null : Number($('cityHue').value),
    blurb: $('cityBlurb').value.trim() || null,
    description: $('cityDescription').value.trim() || null,
    imageUrl: (state.cities.find(city => city.id === state.editingCityId) || {}).imageUrl || null
  };
  setBusy(button, true, 'Saving...');
  try {
    const path = state.editingCityId
      ? '/api/admin/cities/' + encodeURIComponent(state.editingCityId)
      : '/api/admin/cities';
    await api(path, { method: state.editingCityId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    $('cityDialog').close();
    await Promise.all([loadCities(), loadPlaces(state.placePage)]);
    notify(state.editingCityId ? 'City updated.' : 'City created.');
  } catch (error) {
    notify(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function deleteCity(cityId) {
  const city = state.cities.find(item => item.id === cityId);
  if (!city || !confirm('Remove ' + city.name + '? Cities with places cannot be deleted.')) return;
  try {
    await api('/api/admin/cities/' + encodeURIComponent(city.id), { method: 'DELETE' });
    await Promise.all([loadCities(), loadPlaces(state.placePage)]);
    notify('City removed.');
  } catch (error) {
    notify(error.message, true);
  }
}

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40);
}

function openPlaceDialog(place = null) {
  state.editingPlaceId = place ? place.id : null;
  $('placeForm').reset();
  $('placeDialogTitle').textContent = place ? 'Edit place' : 'Add place';
  $('placeId').disabled = Boolean(place);
  $('placeId').value = place ? place.id : '';
  $('placeName').value = place ? place.name || '' : '';
  $('placeCity').value = place ? place.cityId || '' : '';
  $('placeCategory').value = place ? place.category || 'attraction' : 'attraction';
  $('placeDescription').value = place ? place.description || '' : '';
  $('placeAddress').value = place ? place.address || '' : '';
  $('placePhone').value = place ? place.phone || '' : '';
  $('placeWebsite').value = place ? place.website || '' : '';
  $('placeLat').value = place && place.lat != null ? place.lat : 0;
  $('placeLng').value = place && place.lng != null ? place.lng : 0;
  $('placeOpens').value = place ? place.opensAt || '' : '';
  $('placeCloses').value = place ? place.closesAt || '' : '';
  $('placeOpen24h').checked = Boolean(place && place.open24h);
  $('placeOpens').disabled = $('placeOpen24h').checked;
  $('placeCloses').disabled = $('placeOpen24h').checked;
  $('placeClosedDays').value = place && Array.isArray(place.closedDays) ? place.closedDays.join(',') : '';
  $('placeHours').value = place ? place.hoursText || '' : '';
  $('placeExtra').value = place ? place.extra || '' : '';
  $('placeRating').value = place ? place.baseRating || place.avgRating || 3 : 3;
  $('placeImagesCurrent').innerHTML = place ? renderPlaceImages(place) : '';
  $('placeImages').value = '';
  $('placeDialog').showModal();
}

function renderPlaceImages(place) {
  const images = Array.isArray(place.images) ? place.images : [];
  if (!images.length) return '<p class="muted">No uploaded images.</p>';
  return '<div class="image-list-title">Uploaded images</div>' + images.map(image => {
    const imageId = image && typeof image === 'object'
      ? image.id != null ? image.id : image.imageId != null ? image.imageId : null
      : null;
    const imageUrl = image && typeof image === 'object'
      ? image.url || image.imageUrl || null
      : typeof image === 'string' ? image : null;
    const label = image && typeof image === 'object'
      ? image.fileName || image.name || imageUrl || 'Uploaded image'
      : String(image);
    const removeButton = imageId
      ? '<button class="x" type="button" data-action="delete-image" data-id="' + escapeHtml(imageId) + '">Remove</button>'
      : '<span class="muted">Image ID unavailable</span>';
    const imagePreview = imageUrl
      ? '<img src="' + escapeHtml(new URL(imageUrl, API_BASE).toString()) + '" alt="">'
      : '';
    return '<div class="image-item">' + imagePreview + '<span>' + escapeHtml(label) + '</span>' + removeButton + '</div>';
  }).join('');
}

async function editPlace(placeId) {
  try {
    const place = await api('/api/places/' + encodeURIComponent(placeId));
    if (!place || !place.id) throw new Error('The place response did not include an ID.');
    openPlaceDialog(place);
  } catch (error) {
    notify(error.message, true);
  }
}

function closedDaysValue() {
  const value = $('placeClosedDays').value.trim();
  if (!value) return [];
  const days = value.split(',').map(day => Number(day.trim()));
  if (days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error('Closed days must be numbers from 1 to 7.');
  }
  return days;
}

async function savePlace(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  let closedDays;
  try {
    closedDays = closedDaysValue();
  } catch (error) {
    notify(error.message, true);
    return;
  }

  const name = $('placeName').value.trim();
  const id = state.editingPlaceId || slugify($('placeId').value.trim() || name);
  if (!id) {
    notify('Enter a valid place name or ID.', true);
    return;
  }
  const open24h = $('placeOpen24h').checked;
  const payload = {
    id,
    cityId: $('placeCity').value,
    category: $('placeCategory').value,
    name,
    description: $('placeDescription').value.trim(),
    address: $('placeAddress').value.trim(),
    phone: $('placePhone').value.trim(),
    website: $('placeWebsite').value.trim(),
    lat: Number($('placeLat').value || 0),
    lng: Number($('placeLng').value || 0),
    opensAt: open24h ? null : $('placeOpens').value || null,
    closesAt: open24h ? null : $('placeCloses').value || null,
    open24h,
    closedDays,
    hoursText: $('placeHours').value.trim(),
    extra: $('placeExtra').value.trim(),
    baseRating: Number($('placeRating').value)
  };
  const files = Array.from($('placeImages').files || []);
  const oversized = files.find(file => file.size > 5 * 1024 * 1024);
  if (oversized) {
    notify(oversized.name + ' is larger than 5 MB.', true);
    return;
  }

  setBusy(button, true, 'Saving...');
  try {
    const editingId = state.editingPlaceId;
    const path = editingId ? '/api/admin/places/' + encodeURIComponent(editingId) : '/api/admin/places';
    const savedPlace = await api(path, {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    const savedId = editingId || (savedPlace && savedPlace.id);
    $('placeDialog').close();
    await loadPlaces(state.placePage);

    if (files.length && !savedId) {
      notify('Place saved, but the API did not return its ID for image upload.', true);
      return;
    }
    if (files.length) {
      try {
        await uploadPlaceImages(savedId, files);
      } catch (error) {
        notify('Place saved, but image upload failed: ' + error.message, true);
        return;
      }
    }
    notify(editingId ? 'Place updated.' : 'Place created.');
  } catch (error) {
    notify(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function uploadPlaceImages(placeId, files) {
  for (let index = 0; index < files.length; index += 1) {
    const formData = new FormData();
    formData.append('file', files[index]);
    formData.append('sortOrder', String(index));
    await api('/api/admin/places/' + encodeURIComponent(placeId) + '/images', {
      method: 'POST',
      body: formData
    });
  }
}

async function deletePlaceImage(imageId) {
  const placeId = state.editingPlaceId;
  if (!placeId || !imageId || !confirm('Remove this uploaded image?')) return;
  try {
    await api('/api/admin/places/' + encodeURIComponent(placeId) + '/images/' + encodeURIComponent(imageId), {
      method: 'DELETE'
    });
    const place = await api('/api/places/' + encodeURIComponent(placeId));
    $('placeImagesCurrent').innerHTML = renderPlaceImages(place);
    notify('Image removed.');
  } catch (error) {
    notify(error.message, true);
  }
}

async function deletePlace(placeId) {
  const place = state.places.find(item => item.id === placeId);
  if (!place || !confirm('Remove ' + place.name + '? This cannot be undone.')) return;
  try {
    await api('/api/admin/places/' + encodeURIComponent(place.id), { method: 'DELETE' });
    const nextPage = state.places.length === 1 && state.placePage > 0 ? state.placePage - 1 : state.placePage;
    await loadPlaces(nextPage);
    notify('Place removed.');
  } catch (error) {
    notify(error.message, true);
  }
}

async function loadReviews(placeId) {
  if (!placeId) {
    state.reviews = [];
    $('reviewList').innerHTML = '<p class="muted">Choose a place to load its reviews.</p>';
    return;
  }
  $('reviewList').innerHTML = '<p class="muted">Loading reviews...</p>';
  try {
    const result = await api('/api/places/' + encodeURIComponent(placeId) + '/reviews');
    const reviews = Array.isArray(result) ? result : result && result.items;
    if (!Array.isArray(reviews)) throw new Error('The reviews endpoint returned an unexpected response.');
    state.reviews = reviews;
    renderReviews();
  } catch (error) {
    $('reviewList').innerHTML = '<p class="error">' + escapeHtml(error.message) + '</p>';
  }
}

function renderReviews() {
  const container = $('reviewList');
  if (!state.reviews.length) {
    container.innerHTML = '<p class="muted">No reviews for this place.</p>';
    return;
  }
  container.innerHTML = state.reviews.map(review => {
    const rating = Math.max(0, Math.min(5, Number(review.rating || 0)));
    return '<article class="rv"><div><b>' + escapeHtml(review.authorName || 'User') + '</b>' +
      '<div class="stars">' + '&#9733;'.repeat(rating) + '</div><p>' + escapeHtml(review.text || '') + '</p>' +
      '<span class="muted">' + escapeHtml(review.createdAt ? new Date(review.createdAt).toLocaleString() : '') + '</span></div>' +
      (review.id != null ? '<button class="x" type="button" data-action="delete-review" data-id="' + escapeHtml(review.id) + '">Remove</button>' : '<span class="muted">Review ID unavailable</span>') + '</article>';
  }).join('');
}

async function deleteReview(reviewId) {
  if (!reviewId || !confirm('Remove this review? This cannot be undone.')) return;
  try {
    await api('/api/admin/reviews/' + encodeURIComponent(reviewId), { method: 'DELETE' });
    state.reviews = state.reviews.filter(review => String(review.id) !== String(reviewId));
    renderReviews();
    notify('Review removed.');
  } catch (error) {
    notify(error.message, true);
  }
}

function openReviews(placeId) {
  $('reviewPlace').value = placeId;
  setSection('reviews');
  loadReviews(placeId);
}

async function handleLogout() {
  let logoutError = '';
  if (state.refreshToken) {
    try {
      await api('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: state.refreshToken })
      }, false);
    } catch (error) {
      logoutError = error.message;
    }
  }
  clearSession();
  showLogin(logoutError ? 'Signed out locally. Backend logout failed: ' + logoutError : '');
}

function handleActionClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'edit-place') editPlace(id);
  if (action === 'delete-place') deletePlace(id);
  if (action === 'place-reviews') openReviews(id);
  if (action === 'edit-city') openCityDialog(state.cities.find(city => city.id === id));
  if (action === 'delete-city') deleteCity(id);
  if (action === 'delete-review') deleteReview(id);
  if (action === 'delete-image') deletePlaceImage(id);
}

function setupEvents() {
  $('loginForm').addEventListener('submit', handleLogin);
  $('cityForm').addEventListener('submit', saveCity);
  $('placeForm').addEventListener('submit', savePlace);
  $('addCity').addEventListener('click', () => openCityDialog());
  $('addPlace').addEventListener('click', () => openPlaceDialog());
  $('quickAddPlace').addEventListener('click', () => {
    setSection('places');
    openPlaceDialog();
  });
  $('cancelCity').addEventListener('click', () => $('cityDialog').close());
  $('cancelPlace').addEventListener('click', () => $('placeDialog').close());
  $('prevPage').addEventListener('click', () => loadPlaces(Math.max(0, state.placePage - 1)).catch(error => notify(error.message, true)));
  $('nextPage').addEventListener('click', () => loadPlaces(state.placePage + 1).catch(error => notify(error.message, true)));
  $('placeFilters').addEventListener('submit', event => {
    event.preventDefault();
    loadPlaces(0).catch(error => notify(error.message, true));
  });
  ['filterCity', 'filterCategory', 'filterRating', 'filterSort'].forEach(id => {
    $(id).addEventListener('change', () => loadPlaces(0).catch(error => notify(error.message, true)));
  });
  $('q').addEventListener('input', event => {
    $('placeSearch').value = event.currentTarget.value;
    setSection('places');
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadPlaces(0).catch(error => notify(error.message, true)), 300);
  });
  $('reviewPlace').addEventListener('change', event => loadReviews(event.currentTarget.value));
  $('placeRows').addEventListener('click', handleActionClick);
  $('cityRows').addEventListener('click', handleActionClick);
  $('reviewList').addEventListener('click', handleActionClick);
  $('placeImagesCurrent').addEventListener('click', handleActionClick);
  document.querySelectorAll('[data-section]').forEach(button => {
    button.addEventListener('click', () => setSection(button.dataset.section));
  });
  $('menu').addEventListener('click', () => document.body.classList.toggle('open'));
  $('scrim').addEventListener('click', () => document.body.classList.remove('open'));
  $('theme').addEventListener('click', () => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = root.dataset.theme === 'dark' || (!root.dataset.theme && prefersDark);
    root.dataset.theme = isDark ? 'light' : 'dark';
  });
  $('logout').addEventListener('click', handleLogout);
  $('placeOpen24h').addEventListener('change', event => {
    $('placeOpens').disabled = event.currentTarget.checked;
    $('placeCloses').disabled = event.currentTarget.checked;
  });
  $('placeDialog').addEventListener('close', () => {
    state.editingPlaceId = null;
    $('placeId').disabled = false;
  });
}

async function initialize() {
  setupEvents();
  if (!state.accessToken || !state.refreshToken || !state.user || state.user.role !== 'ADMIN') {
    clearSession();
    showLogin();
    return;
  }
  showDashboard();
  await loadInitialData();
}

initialize();
