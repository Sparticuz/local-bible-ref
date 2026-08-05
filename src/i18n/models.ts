import { PassageFormat } from 'src/passage-reference';
import { OmissionMarker, QuoteReferencePosition } from 'src/settings';

export interface Book {
	id: string;
	name: string;
	aliases: string[];
}

export interface CommonLabels {
	folderDoesNotExist: string;
	settingsNotConfigured: string;
}

export interface SettingsLabels {
	required: {
		name: string;
		controls: {
			biblesPath: TextControl;
		};
	};

	optional: {
		name: string;
		controls: {
			defaultVersion: TextControl;
			defaultPassageFormat: Control & {
				options: {
					[PassageFormat.Manuscript]: string;
					[PassageFormat.Paragraph]: string;
					[PassageFormat.Quote]: string;
					[PassageFormat.Callout]: string;
					[PassageFormat.Inline]: string;
				};
			};
			bibleFormat: Control;
			fullPreview: Control;
			omissionMarker: Control & {
				options: {
					[OmissionMarker.None]: string;
					[OmissionMarker.Ellipsis]: string;
				};
			};
		};
	};

	quoteFormat: {
		name: string;
		controls: {
			includeReference: Control;
			referencePosition: Control & {
				options: {
					[QuoteReferencePosition.Beginning]: string;
					[QuoteReferencePosition.End]: string;
				};
			};
			linkToPassage: Control;
		};
	};

	calloutFormat: {
		name: string;
		controls: {
			calloutType: Control;
			linkToPassage: Control;
			collapsible: Control;
		};
	};

	issues: {
		before: string;
		link: string;
		after?: string;
	};
}

interface Control {
	name: string;
	description: string;
}

interface TextControl extends Control {
	placeholder: string;
}
