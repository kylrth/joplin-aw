import joplin from 'api';
import { MenuItemLocation, SettingItemType } from 'api/types';

joplin.plugins.register({
	onStart: async function () {
		// add settings
		await joplin.settings.registerSection('awMain', {
			label: 'Joplin AW',
			iconName: 'fas fa-clock',
		});
		await joplin.settings.registerSettings({
			'periodLength': {
				value: 15,
				type: SettingItemType.Int,
				section: 'awMain',
				public: true,
				label: 'Activity summary bucketing period',
				description: 'The length (in minutes) of the time periods in the activity summary',
			},
			'covPercent': {
				value: 70,
				type: SettingItemType.Int,
				section: 'awMain',
				public: true,
				label: 'Activity summary period coverage (%)',
				description: 'Only list the longest activities that together took at least this much of the time period (skipping short activities)',
			},
			'minCount': {
				value: 0,
				type: SettingItemType.Int,
				section: 'awMain',
				public: true,
				label: 'Minimum # of activities per period',
				description: 'List at least this many activities per time period (if present), regardless of the period coverage setting'
			}
		});

		// add the command
		await joplin.commands.register({
			name: 'getAWLogs',
			label: 'Insert ActivityWatch logs',
			execute: async (...args: any[]) => {
				const period = await joplin.settings.value('periodLength');
				const cov = await joplin.settings.value('covPercent');
				const minCount = await joplin.settings.value('minCount');

				switch (args.length) {
					case 0:
						await getAWLogs(new Date(), period, cov / 100, minCount);
						break;
					case 1:
						const d = parseDateOrOffset(args[0]);
						await getAWLogs(d, period, cov / 100, minCount);
						break;
					default:
						console.error('too many arguments');
				}
			},
		});

		// add to tools menu
		await joplin.views.menuItems.create('toolGetAWLogs', 'getAWLogs', MenuItemLocation.Tools);
	},
});

// parseDateOrOffset returns a Date offset by the number from the current Date if `input` parses to
// a number. Otherwise, expects a date in the format YYYY-MM-DD or MM-DD, and returns that date.
function parseDateOrOffset(input: string): Date {
	const currentDate = new Date();

	// Check if the input is a number (days offset)
	if (/^-?\d+$/.test(input)) {
		const daysOffset = parseInt(input);
		console.debug(`getting data for today + ${daysOffset} days`);
		currentDate.setDate(currentDate.getDate() + daysOffset);
		return currentDate;
	}

	if (!/^(\d\d\d\d-)?\d?\d-\d?\d$/.test(input)) {
		throw new Error('invalid input format');
	}

	// If the input is not a number, treat it as a date string
	const parts = input.split('-').map(part => parseInt(part));
	let date = new Date();
	let year: number, month: number, day: number;

	switch (parts.length) {
		case 3:
			// YYYY-MM-DD
			[year, month, day] = parts;
			break;
		case 2:
			// MM-DD
			[month, day] = parts;
			year = currentDate.getFullYear();
			break;
		default:
			throw new Error('invalid input format');
	}

	date.setFullYear(year, month - 1, day);

	console.debug(`getting data for ${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`);

	return date;
}

async function getAWLogs(
	today: Date, period: number, covPercent: number, minCount: number,
): Promise<void> {
	console.info('requesting logs from ActivityWatch');
	try {
		const info = await getBucketInfo();
		console.info('received bucket info');

		const start = new Date(today);
		start.setHours(0, 0, 0, 0); // midnight last night
		const end = new Date(today);
		end.setHours(24, 0, 0, 0); // midnight tonight

		// get all periods when the user was active (with a grace period of the bucketing period)
		const activePeriods = await getActivePeriods(info.afkBucketID, start, end, period);

		// collect all app usage while the user was active
		var appPeriods: AppPeriod[] = [];
		for (const period of activePeriods) {
			const apps = await getAppPeriods(info.windowBucketID, period.start, period.end);
			appPeriods = appPeriods.concat(apps);
		}
		console.debug(`collected ${appPeriods.length} app usage entries:`, appPeriods);

		if (appPeriods.length === 0) {
			await joplin.commands.execute('insertText', 'No ActivityWatch data :(');
			console.log('empty ActivityWatch data');
			return;
		}

		// collect usage statistics for each period
		const stats = chunkAppPeriods(appPeriods, period);
		console.debug('usage stats:', stats);

		await joplin.commands.execute(
			'insertText',
			summarizeUsageStats(stats, period * 60 * covPercent, minCount),
		);
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
async function getActivePeriods(afkBucketID: string, start: Date, end: Date, grace: number): Promise<Period[]> {
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

	out = mergeOverlapping(out, grace);
	console.debug(`merged into ${out.length} active periods:`, out);

	return out;
}

// mergeOverlapping merges periods with less than `grace` minutes between them
function mergeOverlapping(periods: Period[], grace: number): Period[] {
	if (periods.length === 0) {
		return periods;
	}

	const merged: Period[] = [];

	let currentPeriod = periods[0];

	for (let i = 1; i < periods.length; i++) {
		// add grace period
		const endPlus5 = currentPeriod.end;
		endPlus5.setSeconds(endPlus5.getSeconds() + grace * 60);

		if (periods[i].start <= endPlus5) {
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

function summarizeUsageStats(stats: UsageStats[], covSeconds: number, minCount: number): string {
	let result = '';

	for (const s of stats) {
		result += `- **${formatTime(s.start)}**\n`;

		const sortedApps = Object.entries(s.apps).sort((a, b) => b[1] - a[1]);

		var count = 0;
		var tot = 0;
		for (const [app, duration] of sortedApps) {
			result += `    - ${formatDuration(duration)}: ${app}\n`;
			count++;
			tot += duration;
			if (count >= minCount && tot >= covSeconds) {
				break;
			}
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
