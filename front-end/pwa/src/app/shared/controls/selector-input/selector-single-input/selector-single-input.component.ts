import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { TextInputComponent } from '../../text-input/text-input.component';

interface DisplayOption<T> {
  option: T;
  display: string;
  originalIndex: number;
}

@Component({
  selector: 'app-selector-single-input',
  templateUrl: './selector-single-input.component.html',
  styleUrls: ['./selector-single-input.component.scss']
})
export class SelectorSingleInputComponent<T> implements OnChanges {
  @ViewChild('appSingleSelectorSearchInput') searchInput!: TextInputComponent;

  @Input() public id!: string | number;

  @Input() public label!: string;

   @Input() public labelSuperScript!: string;

  @Input() public placeholder!: string;

  @Input() public displayCancelOption!: boolean;

  @Input() public errorMessage: string = '';

  @Input() public options: T[] = [];

  @Input() public optionDisplayFn: (option: T) => string = (option => String(option));

  @Input() public optionTrackByFn: (index: number, option: T) => unknown = ((index) => index);

  @Input() public selectedOption!: T | null | undefined;

  @Output() public selectedOptionChange = new EventEmitter<T | null>();

  protected displayOptions: DisplayOption<T>[] = [];
  protected filteredOptions: DisplayOption<T>[] = [];
  protected selectedOptionDisplay: string = '';
  protected readonly optionItemSize = 34;
  protected readonly maxRenderedDropdownHeight = 200;

  constructor() {
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Important check because when an option is selected  'ngOnChanges' gets raised. 
    // So to prevent resetting filtered options this check is necessary
    if (changes['options']) {
      if (!this.options) this.options = []; // should never be undefined
      this.displayOptions = this.options.map((option, index) => ({
        option,
        display: this.optionDisplayFn(option),
        originalIndex: index,
      }));
      this.filteredOptions = [...this.displayOptions];
    }

    if (changes['selectedOption']) {
      // TODO. Investigate how this can be avoided when `selectedOption` is changed within this control
      this.setSelectedOptionDisplay();
    }
  }

  private setSelectedOptionDisplay(): void {
    if (this.selectedOption === undefined || this.selectedOption === null) {
      this.selectedOptionDisplay = '';
      return;
    }

    this.selectedOptionDisplay = this.displayOptions.find(item => item.option === this.selectedOption)?.display ?? this.optionDisplayFn(this.selectedOption);
  }

  protected onSearchInput(inputValue: string): void {
    if (!inputValue) {
      this.filteredOptions = [...this.displayOptions];
    } else {
      const lowerCaseInput = inputValue.toLowerCase();
      this.filteredOptions = this.displayOptions.filter(option =>
        option.display.toLowerCase().includes(lowerCaseInput)
      );
    }
  }

  protected onSelectedOption(option: T): void {
    if (this.selectedOption === option) {
      return;
    }

    this.selectedOption = option;
    this.selectedOptionChange.emit(option);
    this.setSelectedOptionDisplay();
  }

  protected onSearchEnterKeyPress(): void {
    // Just select the first
    const firstOption = this.filteredOptions[0]?.option;
    if (firstOption !== undefined) {
      this.onSelectedOption(firstOption);
    }
  }

  protected onCancelOptionClick(): void {
    this.selectedOption = null;
    this.selectedOptionChange.emit(null);
    this.setSelectedOptionDisplay();
  }

  /**
   * Move selected option to the top
   */
  protected onDropDownDisplayed(): void {
    if (this.selectedOption) {
      this.filteredOptions = [...this.filteredOptions].sort((a, b) => {
        if (a.option === this.selectedOption) return -1; // a comes first
        if (b.option === this.selectedOption) return 1;  // b comes first
        return a.originalIndex - b.originalIndex;
      });
    }

    // Set the focus to the search input
    // Set timeout used to give Angular change detection time to render the above the reorder elements
    setTimeout(() => {
      this.searchInput.focus();
    }, 0);
  }

  protected get optionsViewportHeight(): number {
    return Math.min(this.maxRenderedDropdownHeight, Math.max(this.optionItemSize, this.filteredOptions.length * this.optionItemSize));
  }

  protected trackByDisplayOption(index: number, item: DisplayOption<T>): unknown {
    return this.optionTrackByFn(index, item.option);
  }

}
