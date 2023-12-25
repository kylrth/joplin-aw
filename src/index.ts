import joplin from 'api';
import { MenuItemLocation } from 'api/types';

joplin.plugins.register({
	onStart: async function () {
		await joplin.commands.register({
			name: 'getAWLogs',
			label: 'Insert ActivityWatch Logs',
			execute: getAWLogs,
		});

		// add to tools menu
		await joplin.views.menuItems.create('toolGetAWLogs', 'getAWLogs', MenuItemLocation.Tools);
	},
});

async function getAWLogs(): Promise<void> {
	console.info('requesting logs from ActivityWatch');
	try {
		const info = await getBucketInfo();
		console.info('received bucket info');

		const now = new Date();
		const start = new Date(now);
		start.setHours(0, 0, 0, 0); // midnight last night
		const end = new Date(now);
		end.setHours(24, 0, 0, 0); // midnight tonight

		// get all periods when the user was active
		const activePeriods = await getActivePeriods(info.afkBucketID, start, end);

		// collect all app usage while the user was active
		var appPeriods: AppPeriod[] = [];
		for (const period of activePeriods) {
			const apps = await getAppPeriods(info.windowBucketID, period.start, period.end);
			appPeriods = appPeriods.concat(apps);
		}
		console.log(`collected ${appPeriods.length} app usage entries:`, appPeriods);

		if (appPeriods.length === 0) {
			await joplin.commands.execute('insertText', 'No ActivityWatch data :(');
			console.log('empty ActivityWatch data');
			return;
		}

		// collect usage statistics for each 15 minute period
		const stats = chunkAppPeriods(appPeriods, 15);
		console.log('usage stats:', stats);

		await joplin.commands.execute('insertText', summarizeUsageStats(stats));
		console.log('inserted ActivityWatch summary');
	} catch (error) {
		console.error('Error fetching the logs:', error);
		return;
	}
}

// getBucketInfo returns the bucket IDs for all buckets on the local ActivityWatch instance. It
// separately returns the afk bucket ID and the window bucket ID. The rest go in otherBucketIDs.
async function getBucketInfo(): Promise<{
	afkBucketID: string | null;
	windowBucketID: string | null;
	otherBucketIDs: string[];
}> {
	const response = await fetch('http://localhost:5600/api/0/buckets/', {
		method: 'GET',
		headers: {
			'accept': 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`getting bucket info failed with status ${response.status}`);
	}

	const data = await response.json();

	// get the afk bucket ID, the window bucket ID, and any other bucket IDs
	let afkBucketID: string | null = null;
	let windowBucketID: string | null = null;
	const otherBucketIDs: string[] = [];

	for (const bucketID in data) {
		if (data[bucketID].type === "afkstatus") {
			if (afkBucketID != null) {
				throw new Error('found a second afkstatus bucket, not sure how to handle that')
			}
			afkBucketID = bucketID;
		} else if (data[bucketID].type === "currentwindow") {
			if (windowBucketID != null) {
				throw new Error('found a second currentwindow bucket, not sure how to handle that')
			}
			windowBucketID = bucketID;
		} else {
			otherBucketIDs.push(bucketID);
		}
	}

	if (!afkBucketID) {
		throw new Error('required bucket for afkstatus not found');
	}
	if (!windowBucketID) {
		throw new Error('required bucket for currentwindow not found');
	}

	return { afkBucketID, windowBucketID, otherBucketIDs };
}

interface Period {
	start: Date;
	end: Date;
}

// getActivePeriods returns the periods between start and end when the user was active, according to
// the afk bucket.
async function getActivePeriods(afkBucketID: string, start: Date, end: Date): Promise<Period[]> {
	const events = await getEvents(afkBucketID, start, end);

	let out = events
		.filter(event => event.data.status === 'not-afk')
		.map(event => {
			const start = new Date(event.timestamp);
			const end = new Date(event.timestamp);
			end.setSeconds(end.getSeconds() + event.duration);

			return {
				start: start,
				end: end,
			}
		});

	console.debug(`collected ${out.length} active periods:`, out);

	out = mergeOverlapping(out);
	console.debug(`merged into ${out.length} active periods:`, out);

	return out;
}

function mergeOverlapping(periods: Period[]): Period[] {
	if (periods.length === 0) {
		return periods;
	}

	const merged: Period[] = [];

	let currentPeriod = periods[0];

	for (let i = 1; i < periods.length; i++) {
		if (periods[i].start <= currentPeriod.end) {
			// If the current period overlaps with the next, merge them.
			currentPeriod.end = new Date(Math.max(currentPeriod.end.getTime(), periods[i].end.getTime()));
		} else {
			// If they don't overlap, push the current period and start a new one.
			merged.push(currentPeriod);
			currentPeriod = periods[i];
		}
	}

	merged.push(currentPeriod);

	return merged;
}

interface AppPeriod {
	title: string;
	start: Date;
	end: Date;
}

// getAppPeriods returns all of the apps used between start and end, with start/stop times.
async function getAppPeriods(windowBucketID: string, start: Date, end: Date): Promise<AppPeriod[]> {
	const events = await getEvents(windowBucketID, start, end);

	const periods: AppPeriod[] = events.map(event => {
		const start = new Date(event.timestamp);
		const end = new Date(start.getTime() + event.duration * 1000);

		return {
			title: makeTitle(event.data),
			start: start,
			end: end,
		};
	}).sort((a, b) => a.start.getTime() - b.start.getTime());

	// merge consecutive periods of the same app, if the end of one is within 5s of the start of the
	// next
	const merged: AppPeriod[] = [];
	let currentPeriod: AppPeriod | null = null;
	for (const period of periods) {
		if (currentPeriod && period.title === currentPeriod.title
			&& currentPeriod.end.getTime() + 5000 > period.start.getTime()) {
			// merge
			currentPeriod.end = period.end;
		} else {
			if (currentPeriod) {
				merged.push(currentPeriod);
			}
			currentPeriod = period;
		}
	}

	return merged;
}

// makeTitle creates the unique title, usually from the app name and the window title.
function makeTitle(data: any): string {
	switch (data.app) {
		case 'firefox':
			const page = data.title.slice(0, -' — Mozilla Firefox'.length);

			if (page === '') {
				return 'Firefox';
			}
			return 'Firefox: ' + page;
		case 'VSCodium':
			let title = data.title;
			if (title.startsWith('● ')) {
				title = title.substring(2);
			}

			return 'VSCodium: ' + title.slice(0, -' - VSCodium'.length);
		default:
			return data.app + ': ' + data.title;
	}
}

// AWEvent is a single entry in the ActivityWatch log
interface AWEvent {
	id: number;
	timestamp: string;
	duration: number;
	data: any;
}

// getEvents requests all of the events between the specified timestamps, including any previous
// event that extends into the requested interval. The events are sorted by timestamp.
async function getEvents(bucketID: string, start: Date, end: Date): Promise<AWEvent[]> {
	const baseURL = `http://localhost:5600/api/0/buckets/${bucketID}/events`;
	let params = new URLSearchParams({
		start: start.toISOString(),
		end: end.toISOString(),
	});
	let url = `${baseURL}?${params.toString()}`;

	let response = await fetch(url, {
		method: 'GET',
		headers: {
			'accept': 'application/json',
		},
	});
	if (!response.ok) {
		throw new Error(`getting bucket '${bucketID}' contents failed with status: ${response.status}`);
	}

	const events = await response.json() as AWEvent[];

	// check if there was a previous event that extended into this event
	// We don't want to check all the events, but it's possible that some events that started
	// earlier have later end times, so we'll grab the last 5 and check them.
	params = new URLSearchParams({
		end: start.toISOString(),
		limit: '5',
	});
	url = `${baseURL}?${params.toString()}`;

	response = await fetch(url, {
		method: 'GET',
		headers: {
			'accept': 'application/json',
		},
	});
	if (!response.ok) {
		throw new Error(`getting previous bucket '${bucketID}' contents failed with status: ${response.status}`);
	}

	const newEvents = await response.json() as AWEvent[];

	// filter newEvents to find any that end after 'start'
	let overlappingEvents = newEvents.filter((event: AWEvent) => {
		const eventStart = new Date(event.timestamp)
		const eventEnd = new Date(eventStart.getTime() + event.duration * 1000);
		return eventEnd > start;
	});

	// concatenate the filtered overlappingEvents with the initially fetched events
	return [...overlappingEvents, ...events]
		.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// UsageStats contains statistics on the total time apps were used during a certain window.
interface UsageStats {
	start: Date;
	end: Date;
	apps: { [key: string]: number };
}

function chunkAppPeriods(periods: AppPeriod[], minutes: number): UsageStats[] {
	let results: UsageStats[] = [];
	let chunkStart: Date = periods[0].start;
	let chunkEnd: Date = new Date(chunkStart.getTime() + minutes * 60000);
	let currentChunk: AppPeriod[] = [];

	periods.forEach(period => {
		while (period.start >= chunkEnd) {
			if (currentChunk.length > 0) {
				results.push({
					start: chunkStart,
					end: chunkEnd,
					apps: getUsageStats(currentChunk),
				});
				currentChunk = [];
			}
			chunkStart = new Date(chunkStart.getTime() + minutes * 60000);
			chunkEnd = new Date(chunkEnd.getTime() + minutes * 60000);
		}

		currentChunk.push(period);
	});

	// Process the last chunk if it's not empty
	if (currentChunk.length > 0) {
		results.push({
			start: chunkStart,
			end: chunkEnd,
			apps: getUsageStats(currentChunk),
		});
	}

	return results;
}

function getUsageStats(periods: AppPeriod[]): { [key: string]: number } {
	let usage: { [key: string]: number } = {};

	// assume periods are non-overlapping and sorted by start time
	periods.forEach(period => {
		const duration = (period.end.getTime() - period.start.getTime()) / 1000; // duration in seconds

		usage[period.title] = (usage[period.title] || 0) + duration;
	});

	return usage;
}

function summarizeUsageStats(stats: UsageStats[]): string {
	let result = '';

	for (const s of stats) {
		result += `- **${formatTime(s.start)}**\n`;

		const sortedApps = Object.entries(s.apps).sort((a, b) => b[1] - a[1]);
		for (const [app, duration] of sortedApps) {
			result += `    - *${formatDuration(duration)}*: ${app}\n`;
		}
	}

	return result;
}

// formatTime returns the local 24-hour wall clock time, e.g. "13:45".
function formatTime(date: Date): string {
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }).toLowerCase();
}

// formatDuration converts a time in seconds into "MM:SS".
function formatDuration(s: number): string {
	const mins = Math.floor(s / 60);
	const secs = Math.round(s % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}
