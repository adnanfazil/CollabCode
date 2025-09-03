const myArray = [1, 2, 3, 4, 5];
const doubledArray = myArray.map(item => item * 2);
console.log(doubledArray);

const evenNumbers = doubledArray.filter(item => item % 2 === 0);
console.log(evenNumbers);

const sumOfEvens = evenNumbers.reduce((sum, item) => sum + item, 0);
console.log(sumOfEvens);

const averageOfEvens = sumOfEvens / evenNumbers.length;
console.log(averageOfEvens);

const squaredEvens = evenNumbers.map(item => item * item);
console.log(squaredEvens);











